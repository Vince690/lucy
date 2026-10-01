/**
 * Libellés anglais des réponses du questionnaire d'inscription, pour le prompt.
 *
 * Les clés sont celles des écrans d'onboarding de l'app (locales `onboarding:quiz.*`,
 * clés de base sans suffixe `_female`). Le bloc de prompt est construit UNIQUEMENT
 * à partir de cette table : une clé absente d'ici est ignorée. C'est ce qui rend
 * inoffensive la colonne `profiles.onboarding_answers`, que l'app peut écrire : rien
 * de ce qu'elle contient n'atteint le modèle tel quel.
 *
 * Écrit à la troisième personne (« their sleep ») : le prompt parle de la personne
 * à Lucy. Le prompt est en anglais, comme le reste (voir chatSystemPrompt.ts).
 */

export const ONBOARDING_ANSWER_LABELS = {
  mood: {
    thriving: 'thriving',
    pretty_good: 'pretty good',
    mixed: 'mixed',
    not_great: 'not great',
    struggling: 'struggling',
  },
  energy: {
    bursting: 'bursting with energy',
    in_shape: 'in good shape',
    average: 'average',
    bit_tired: 'a bit tired',
    rock_bottom: 'at rock bottom',
  },
  concerns: {
    stress: 'their stress level',
    sleep: 'their sleep',
    future: 'their future',
    relationships: 'their relationships',
    loneliness: 'their loneliness',
    self_confidence: 'their self-confidence',
    work_studies: 'their work or studies',
    health: 'their health',
    finances: 'their finances',
    nothing_special: 'nothing in particular',
  },
  stress: {
    enormously: 'enormously',
    quite_a_bit: 'quite a bit',
    okay: 'somewhat',
    not_much: 'not much',
    not_at_all: 'not at all',
  },
  talk_to: {
    almost_anyone: 'almost anyone',
    a_few_people: 'a few people',
    my_partner: 'their partner',
    my_family: 'their family',
    an_ai: 'an AI',
    hardly_anyone: 'hardly anyone',
    keep_to_myself: "they'd rather not talk about it",
  },
  openness: {
    almost_too_easy: 'almost too easy',
    easy: 'easy',
    right_people: 'easy with the right people',
    not_that_simple: 'not that simple',
    very_hard: 'very hard',
  },
  goals: {
    manage_stress: 'manage their stress better',
    sleep_better: 'sleep better',
    understand_emotions: 'understand their emotions',
    feel_less_alone: 'feel less alone',
    build_confidence: 'build their confidence',
    see_clearly: 'see things more clearly',
    someone_to_talk: 'have someone to talk to',
    just_talk: 'simply chat',
  },
  pride: {
    my_journey: 'their journey',
    my_family: 'their family',
    work_studies: 'their work or studies',
    kindness: 'their kindness',
    creativity: 'their creativity',
    independence: 'their independence',
    overcoming_hardship: 'having overcome hardship',
    friendships: 'their friendships',
    perseverance: 'their perseverance',
    honesty: 'their honesty',
    humor: 'their humor',
    curiosity: 'their curiosity',
    caring_for_others: 'caring for others',
    personal_growth: 'their personal growth',
    courage: 'their courage',
  },
  understood: {
    my_sensitivity: 'their sensitivity',
    need_for_calm: 'their need for calm',
    my_emotions: 'their emotions',
    life_choices: 'their life choices',
    need_for_independence: 'their need for independence',
    my_past: 'their past',
    way_of_seeing: 'their way of seeing things',
    my_silences: 'their silences',
  },
} as const;

export type OnboardingAnswerField = keyof typeof ONBOARDING_ANSWER_LABELS;
