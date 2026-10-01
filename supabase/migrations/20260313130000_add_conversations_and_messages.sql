/*
  # Create conversations and messages tables (mémoire Lucy étape 2.2)

  1. New Tables
    - `conversations`
      - `id` (uuid, primary key)
      - `user_id` (uuid, FK -> auth.users)
      - `next_msg_seq` (integer, default 1) - next sequence number to assign
      - `user_msg_count` (integer, default 0) - count of user-role messages
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)

    - `messages`
      - `id` (uuid, primary key)
      - `conversation_id` (uuid, FK -> conversations)
      - `user_id` (uuid, FK -> auth.users)
      - `role` (text, 'user' or 'assistant')
      - `content` (text)
      - `msg_seq` (integer) - per-conversation sequential number
      - `created_at` (timestamptz)

  2. Indexes
    - (conversation_id, msg_seq) on messages for fast ordered retrieval
    - (user_id) on conversations for user lookup

  3. Notes
    - RLS is NOT enabled here (planned for étape 2.8)
    - No existing tables are modified
*/

-- conversations table (must be created first, referenced by messages)
CREATE TABLE IF NOT EXISTS conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  next_msg_seq integer NOT NULL DEFAULT 1,
  user_msg_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_conversations_user_id ON conversations(user_id);

-- auto-update updated_at on conversations
CREATE TRIGGER update_conversations_updated_at
  BEFORE UPDATE ON conversations
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- messages table
CREATE TABLE IF NOT EXISTS messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user', 'assistant')),
  content text NOT NULL,
  msg_seq integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- primary query pattern: last N messages in a conversation ordered by seq
CREATE INDEX IF NOT EXISTS idx_messages_conversation_seq ON messages(conversation_id, msg_seq);

-- ensure no duplicate seq within a conversation
ALTER TABLE messages ADD CONSTRAINT uq_messages_conversation_msg_seq UNIQUE (conversation_id, msg_seq);
