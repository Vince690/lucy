-- Add explicit consent tracking for the processing of health-related data
-- (mood entries, chat conversations, AI memory), as required by Art. 9(2)(a) GDPR.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS privacy_consent_given boolean DEFAULT false NOT NULL,
  ADD COLUMN IF NOT EXISTS privacy_consent_at timestamptz;
