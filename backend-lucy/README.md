# Backend Lucy

Service Node/TypeScript pour Lucy : authentification Supabase, endpoints `/chat` et `/memory/reset`, et worker des jobs mémoire (`snapshot_50` uniquement). Les clés LLM (GPT‑5.6 Luna pour le chat et les snapshots ; GPT‑5 mini et nano sont retirés par OpenAI le 11 décembre 2026) restent côté backend uniquement.

Le chat utilise l’[**API Responses**](https://developers.openai.com/api/docs) d’OpenAI (`responses.create`) : extraction du texte via `output_text` / items de sortie, et messages de secours si le modèle ne renvoie pas de texte exploitable (refus, filtre, etc.).

## Prérequis

- Node.js 18+
- Un projet Supabase (URL + anon key + service_role key)

## Installation

```bash
cd backend-lucy
npm install
```

## Configuration

1. Copier le fichier d’exemple des variables d’environnement :
   ```bash
   cp .env.example .env
   ```

2. Remplir `.env` avec tes valeurs :
   - **SUPABASE_URL** : URL du projet (ex. `https://xxx.supabase.co`). Même valeur que dans l’app Expo.
   - **SUPABASE_ANON_KEY** : clé « anon » (Project Settings → API). Utilisée pour vérifier le JWT des utilisateurs.
   - **SUPABASE_SERVICE_ROLE_KEY** : clé « service_role » (Project Settings → API). **Ne jamais exposer côté client.** Utilisée pour les opérations base de données côté backend.
   - **DATABASE_URL** : URI de connexion Postgres (Project Settings → Database → Connection string, format URI). **Obligatoire pour le worker** qui exécute les snapshots : les étapes 5.4–5.5 (TTL, `memory_snapshots`, application mémoire) utilisent le client `pg` dans une **transaction unique** `BEGIN`/`COMMIT`. Sans cette variable, `POST /chat` peut tourner, mais `npm run worker` échouera lors de l’application d’un snapshot.
   - **LUCY_LLM_API_KEY** : clé API de ton fournisseur LLM (GPT‑5.6 Luna). Tu peux laisser vide pour faire tourner le serveur en stub ; elle sera requise pour les vrais appels `/chat`.
   - **LUCY_LLM_MODEL** : modèle chat (défaut `gpt-5.6-luna`).
   - **LUCY_LLM_REASONING_EFFORT** *(optionnel)* : effort de raisonnement du chat — `default` \| `none` \| `minimal` \| `low` \| `medium` \| `high` (défaut `low`). Le raisonnement est facturé au **tarif output** et pèse plus de 90 % du coût par tour, les réponses de Lucy ne faisant que 2-3 phrases. Mesuré sur 50 réponses par palier avec le prompt réel : `low` tient la même adhérence aux CRITICAL RULES que le défaut du modèle (4 violations sur 50 dans les deux cas) pour ~60 % de coût output en moins et ~2× moins de latence ; `minimal` dégrade nettement (40 % de réponses fautives). `default` omet le paramètre et rend la main au modèle — c'est le retour arrière, sans toucher au code. **Les valeurs acceptées dépendent du modèle** (`gpt-5-mini` refuse `none`, `gpt-5.6-luna` refuse `minimal`) ; une valeur refusée fait échouer tous les appels `/chat`, d'où la validation au démarrage.
   - **LUCY_SNAPSHOT_LLM_MODEL** : modèle snapshot (défaut `gpt-5.6-luna`). Même clé que le chat si même fournisseur, ou `LUCY_SNAPSHOT_LLM_API_KEY` si fournisseur distinct. Le modèle doit supporter `response_format: { type: "json_object" }`.
   - **LUCY_SNAPSHOT_LLM_API_KEY** *(optionnel)* : clé API dédiée au LLM snapshot. Si absent, `LUCY_LLM_API_KEY` est utilisée.
   - **DB_STATEMENT_TIMEOUT_MS** *(optionnel)* : durée max (ms) des instructions SQL **par transaction** côté worker lors des snapshots (`SET LOCAL statement_timeout` après `BEGIN`, défaut `120000`). À ajuster si les grosses bases dépassent le délai.
   - **REVENUECAT_SECRET_API_KEY** : clé **secrète** de l'API REST RevenueCat, **version V1** (dashboard → Project settings → API keys → « + New », nom libre, version V1 ; commence par `sk_`, affichée une seule fois à la création). Jamais la clé publique du SDK. Le serveur appelle l'API v1 (`GET /v1/subscribers/{id}`), d'abord en production puis avec `X-Is-Sandbox: true` : sans cet en-tête, l'API cache les achats bac à sable (TestFlight, relecteur Apple). Sert à la **porte du chat** (voir plus bas) : elle n'est interrogée que lorsqu'une personne a épuisé ses échanges offerts. Sans elle, ces personnes reçoivent `503 subscription_unverifiable`, abonnés compris.
   - **REVENUECAT_ENTITLEMENT_ID** *(optionnel)* : identifiant de l'entitlement, au caractère près celui du dashboard (défaut `Lucy Premium`, comme dans l'app).
   - **LOG_LEVEL** *(optionnel)* : `debug` \| `info` \| `warn` \| `error` (défaut : `info` en dev/prod). Filtre les lignes JSON sur stdout/stderr. En `NODE_ENV=test` sans `LOG_LEVEL`, le défaut est `warn` pour limiter le bruit des tests. Les détails intermédiaires du snapshot (`snapshot.payload`, `snapshot.extraction`) et le cycle worker (`worker.processing`, etc.) sont en **`debug`**.

## Logs structurés (§9.1)

Chaque événement est une **ligne JSON** (Datadog / CloudWatch / `jq`). Ne pas logger le contenu des messages utilisateur ni les JWT.

Exemples d’événements côté API : `chat.response`, `memory.reset`. Côté worker : `snapshot.done` (toujours avec `outcome`: `ok` ou `failed` + métriques), `worker.cycle_start` / `worker.cycle_end`, `worker.job_replanned`, `worker.job_failed_permanent`, etc.

Filtrer les échecs snapshot en local :

```bash
npm run worker 2>&1 | jq 'select(.event=="snapshot.done" and .outcome=="failed")'
```

## Lancer le serveur

```bash
npm run dev
```

Le serveur écoute sur le port 4000 (ou la valeur de `PORT` dans `.env`).

- **GET /health** : santé du service (pas d’auth).
- **POST /chat** : envoi d’un message (auth requise). Body : `{ "conversation_id?", "message_text" }`. Header : `Authorization: Bearer <JWT Supabase>`.
- **POST /memory/reset** : reset mémoire utilisateur (auth requise, JWT Supabase). Body JSON vide `{}`. Appelle la RPC Postgres `reset_user_memory` (suppression des conversations en cascade, tables mémoire Lucy, **`mood_entries`** (historique suivi d’humeur), journal `user_memory_reset_log` — §VI). **À utiliser avec les migrations** à jour (voir `supabase/migrations/`, notamment `reset_user_memory`).

## Worker des jobs mémoire

Le worker traite les jobs `snapshot_50` depuis la table `memory_jobs`.

```bash
npm run worker
```

**Pipeline snapshot_50 (étapes 5.2–5.5)** : construction du payload (segment conversationnel + mémoire actuelle), appel LLM snapshot, parsing JSON, validation Zod section par section. Ensuite **une transaction Postgres** (`pg`) : `DELETE` TTL sur `user_ephemeral_events` (§V.9), upsert `memory_snapshots`, puis application des sections mémoire dans l’ordre §V.10 (identité → … → life events), avec `normalize_text()` SQL pour les clés. Les sections invalides sont ignorées à la validation (§I.B). **Politique de retry (§IV.5.3)** : le worker distingue trois catégories d’erreur via `isRetryableError()` :

| Erreur | Retentable | Raison |
|--------|-----------|--------|
| `LlmNetworkError` (réseau, auth, quota) | ✅ oui | Transitoire — peut réussir à la prochaine tentative |
| `LlmParseError` (réponse vide, JSON tronqué/invalide) | ❌ non | Déterministe — même input → même JSON invalide |
| `NonRetryableError` (conversation introuvable, etc.) | ❌ non | Erreur logique permanente — jamais corrigée par un retry |
| Deadlock / serialization failure pg (`40P01`, `40001`) | ✅ oui | Transitoire de concurrence |
| Toute autre erreur inconnue | ✅ oui | Bénéfice du doute, plafonnée par `WORKER_MAX_RETRIES` |

Les jobs retentables repassent en `pending` avec `next_retry_at = now() + WORKER_RETRY_BACKOFF_MS` ; au-delà de `WORKER_MAX_RETRIES` tentatives, ils passent en `failed` définitif. Les jobs non-retentables passent directement en `failed` sans consommer le budget retry.

Toute erreur SQL pendant l’application mémoire annule la transaction (`ROLLBACK`) ; le job est marqué en échec et, si l’erreur est retentable (ex. deadlock), replanifié (idempotence : `ON CONFLICT` sur `memory_snapshots`, dédup tables mémoire — §V.13).

## Porte du chat : 5 échanges offerts, puis abonnement (23 septembre 2026)

Depuis le 23 septembre 2026, le paywall ne se dresse plus avant l'app : après l'onboarding, la personne entre dans le vrai chat et dispose de **`FREE_EXCHANGES_LIMIT` = 5 échanges** (un échange = une requête `POST /chat`, soit une rafale de messages et une réponse de Lucy), **une seule fois pour toujours**. Le compteur est `profiles.free_exchanges_used` : par personne, jamais remis à zéro (ni le lendemain, ni après réinstallation, ni après une remise à zéro de la mémoire), protégé par un trigger contre toute écriture depuis l'app (migration `20260923120000_chat_gate_free_exchanges.sql`).

À chaque `POST /chat`, avant toute écriture (`services/chatGateService.ts`) :

1. la RPC `chat_gate_consume` consomme un échange offert si le compteur est sous la limite (un seul `UPDATE` conditionnel, atomique) ; si oui, la requête passe, sans appel réseau ;
2. sinon, `services/subscriptionService.ts` demande à RevenueCat (`GET /v1/subscribers/{id}`, clé secrète, cache court) si l'entitlement est actif ;
3. abonné → passe ; non abonné → **`402 free_exchanges_exhausted`** avec `free_exchanges_used` / `free_exchanges_limit` / `chat_wall_reached_at` (l'app affiche le mur : cadeau → frise → paywall) ; RevenueCat injoignable → **`503 subscription_unverifiable`** (on bloque, on ne laisse jamais passer au doute).

Le premier 402 pose aussi `profiles.chat_wall_reached_at` (RPC `chat_gate_mark_wall`). C'est ce marqueur, et non le compteur, qui referme l'app derrière le paywall aux ouvertures suivantes : le mur tombe au sixième **envoi**, jamais à la cinquième réponse.

Un échange consommé dont le traitement échoue ensuite est rendu (`chat_gate_refund`). La réponse `200` porte `chat_access` (`free` | `premium`) et les deux compteurs, pour que l'app pose le mur au sixième envoi sans attendre le refus.

Lucy reçoit aussi, dès le premier message, les réponses du questionnaire d'inscription (`profiles.onboarding_answers`, clés d'options écrites par l'app) sous forme d'un bloc « What they told you when they signed up » : chaque clé passe par la table `prompts/onboardingAnswerLabels.ts`, une clé inconnue est ignorée, rien de la colonne n'atteint le modèle tel quel.

## Contraintes performance & coûts (§VII)

Ces règles sont intentionnelles et verrouillées dans le code (`CONTEXT_MESSAGES_LIMIT`, `SEGMENT_USER_MESSAGES`) avec des tests dédiés (`src/services/__tests__/perfConstraints.test.ts`).

| Règle | Valeur | Pourquoi |
|---|---|---|
| Fenêtre LLM chat | **50 messages** | Limite le contexte envoyé au LLM (coût tokens, latence). Seuls les 50 derniers messages de la conversation sont injectés dans chaque appel chat (30 jusqu'au 5 septembre 2026). |
| Déclenchement snapshot | **à 15 messages utilisateur, puis tous les 50** | Extraction mémoire en batch, pas à chaque message. La RPC `write_user_message` insère un job `snapshot_50` quand `user_msg_count` vaut `v_snapshot_first_user_msg_count` (15) ou un multiple de `v_snapshot_user_msg_period` (50), alignés sur `SNAPSHOT_FIRST_TRIGGER_USER_MESSAGES` / `SEGMENT_USER_MESSAGES` — test `sqlSnapshotPeriodAlignment.test.ts`. Le premier seuil ne se reproduit pas, sauf après un reset mémoire ou une suppression de compte (la conversation repart de zéro). |
| Embeddings / vector DB | **aucun (MVP)** | La mémoire longue repose sur des tables structurées + scoring de récence/force, sans couche vectorielle. Pas de pgvector, Pinecone, Chroma, etc. |

Si tu ajustes une de ces valeurs, aligne : `constants.ts`, `v_snapshot_user_msg_period` / `v_snapshot_first_user_msg_count` dans la dernière migration `write_user_message`, les tests `perfConstraints` / `sqlSnapshotPeriodAlignment`, et ce tableau.

Le system prompt reçoit aussi un bloc « Right now » à chaque appel : date et heure locales (fuseau du profil) et délai depuis le message utilisateur précédent s'il dépasse une heure. Le prénom, l'âge (recalculé à chaque appel) et le genre viennent de `profiles`, pas de `user_identity` : c'est le profil que l'écran Réglages modifie.

## Ce que tu dois fournir

- Les clés Supabase (URL, anon, service_role) dans ton `.env`.
- La clé API LLM quand tu veux activer les vrais appels chat/snapshot.
- Lancer le backend avec `npm run dev` (et éventuellement le worker via un cron).

L’app Expo continue d’utiliser `EXPO_PUBLIC_SUPABASE_URL` et `EXPO_PUBLIC_SUPABASE_ANON_KEY` ; elle appellera le backend Lucy en envoyant le token Supabase dans `Authorization: Bearer <access_token>` (récupéré via `useAuth()` / `session.access_token`).
