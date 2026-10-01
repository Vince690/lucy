-- Migration: add normalize_text(text) -> text
-- Deterministic text normalization for deduplication keys (mémoire Lucy étape 2.1)

-- Ensure the unaccent extension is available (must be before the function)
create extension if not exists unaccent schema public;

create or replace function public.normalize_text(input text)
returns text
language sql
immutable
parallel safe
as $$
  select
    -- 5. Remove accents via unaccent, puis trim final
    trim(
      public.unaccent(
        -- 4. Collapse multiple spaces into one
        regexp_replace(
          -- 3. Strip border punctuation: . , ! ? : ; ' "
          regexp_replace(
            regexp_replace(
              -- 2. Lowercase after 1. Trim
              lower(trim(input)),
              -- leading punctuation
              '^[.,!?:;''"]+', '', 'g'
            ),
            -- trailing punctuation
            '[.,!?:;''"]+$', '', 'g'
          ),
          '\s+', ' ', 'g'
        )
      )
    );
$$;

comment on function public.normalize_text(text) is
  'Normalise un texte pour déduplication : trim, minuscules, suppression ponctuation bordure, espaces multiples→1, suppression accents.';
