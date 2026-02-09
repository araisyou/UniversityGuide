export type LlmResponse = {
  user_text: string;
  reply_text: string;
  motion?: string | null;
  function?: string | null;
};
