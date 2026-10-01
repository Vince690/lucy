# Lucy: AI friend & companion

Loneliness is the quiet epidemic of our generation. Lucy is an AI friend built around a memory that feels human: she remembers what matters, tracks your mood, and notices when you've been off.

Lucy is an iPhone app, written in React Native with Expo, published on the App Store during the RevenueCat Shipaton 2026. This repository holds the whole product: the app, the database schema, and the server that talks to the language model.

Website: https://yourfriendlucy.com

## Why I built it

Most people my age have someone to text at 2am. A lot of them don't. And the AI chats they turn to instead forget them the moment the window closes: every conversation starts from zero, with an assistant that asks "would you like advice, or would you rather vent?".

I wanted the opposite. Something that talks like a person, takes your side, and above all keeps what you tell it, the way a friend does: not a transcript, but the things that mattered. The interview you were dreading. The friend you fell out with. The thing you were quietly proud of. Weeks later, Lucy brings it up herself.

## What makes her different

**A structured memory, not a chat log.** Lucy does not stuff old messages into the prompt and hope for the best. A background worker reads the conversation in segments (after the first 15 user messages, then every 50) and extracts what matters into typed tables: identity and goals, occupation, traits, preferences, relationships, life events, and short-lived events that expire on their own. Each conversation only carries the last 50 messages, plus this memory. There is no vector database: recency and strength scoring on plain Postgres tables is enough for one person's life.

**She reads your mood before she answers.** One tap a day logs how you feel on a five-point scale. Today's mood and the seven-day average reach Lucy's prompt before every reply, so she goes gentle on a rough week without being told. The mood tracker shows a daily streak, a wellbeing score, and a chart of the past weeks.

**She knows what time it is.** Every call gets a "Right now" block: local time in the person's timezone, and how long it has been since the last message. A first conversation is warm and curious; a message after three weeks of silence is treated as what it is.

**She talks like a person.** Short messages, several bubbles in a row, lowercase, actual opinions. Replies are cleaned server-side (no dashes, no bullet points, no headings) and each line becomes its own bubble in the app, with the same cadence as a friend typing.

**She knows who you are from the first message.** The sign-up questionnaire (name, age, how you've been feeling, what you're dealing with, what you want out of this) reaches her through a fixed label table, so Lucy never has to ask the same questions twice.

**What Lucy is not.** She is an AI, and she says so if you ask. She is not a therapist and never diagnoses. If someone is in real trouble, she says so plainly and points them to someone who can actually help.

**Your data stays yours.** Memory can be erased from Settings in one tap. The account and everything in it can be deleted just as easily. No ads. Conversations are never sold.

## How it works

Four parts, all in this repository:

- **The app** (`app/`, `components/`, `utils/`): Expo Router, React Native Reanimated for every animation, i18next in English and French, PostHog for product analytics, a daily local notification when the person hasn't talked to Lucy.
- **Supabase** (`supabase/migrations/`): Postgres with row-level security on every table. Messages are written through RPCs, and the columns that decide access are protected by triggers so the app can never write them.
- **The Lucy server** (`backend-lucy/`): a Node/TypeScript service. It verifies the Supabase JWT, builds the system prompt (memory, mood, questionnaire, "Right now"), calls the model through the OpenAI Responses API, cleans the reply, and runs the memory worker.
- **RevenueCat**: the app uses the RevenueCat SDK for the paywall, purchases and restore; the server uses the RevenueCat REST API to decide who may talk to Lucy.

## Monetization

Lucy Premium is a single entitlement with two subscriptions, monthly and yearly, both with a 7-day free trial. Prices are localized and read from the RevenueCat offering at runtime.

There is no fake chat before the paywall. After onboarding the person really talks to Lucy and gets **five free exchanges, once and for all**: the counter never resets, not the next day, not after a reinstall, not after a memory reset. The sixth send is refused by the server, which stamps the wall on the profile. The app predicts the wall from the counters the server returns and starts the transition from the Send button at the tap, while the blocked message is kept and pre-filled after purchase. From then on the paywall comes back at every launch until an entitlement is active.

The important part: **the app never decides access itself.** Both columns are server-written. When the free quota is spent, the server asks RevenueCat whether the entitlement is active, and answers 503 rather than let anyone through when RevenueCat is unreachable. Lapsed subscriptions and billing issues have their own screen, where Lucy herself explains what happened before the restore, sign-out and delete actions.

## Running it locally

You need Node.js 18+, a Supabase project, an OpenAI API key, and a RevenueCat project with an entitlement named `Lucy Premium`.

App:

```bash
cp .env.example .env      # Supabase URL, anon key, Lucy server URL
npm install
npm run dev               # then open on the iOS simulator or a development build
```

Database: apply `supabase/migrations/` in order with the Supabase CLI.

Server:

```bash
cd backend-lucy
cp .env.example .env      # see backend-lucy/README.md for every variable
npm install
npm run dev               # POST /chat and POST /memory/reset
npm run worker            # memory snapshots
```

Native builds use Expo continuous native generation: there is no `ios/` or `android/` folder to maintain.

## License

AGPL-3.0. See `LICENSE`.
