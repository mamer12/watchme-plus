import type { ChatMsg, TonightFilters, TonightReply } from '../../../supabase/functions/spark-tonight/validate';

export type { ChatMsg, TonightFilters, TonightReply };
export type Lang = 'en' | 'ar';

/** A tappable answer: what the chip shows and what it means. */
export interface Choice {
  label: string;
  value: string;
}

/** Why the AI could not answer; any of these switches the chat to the fixed questions. */
export type FailReason = 'no_session' | 'not_configured' | 'rate_limited' | 'unavailable' | 'timeout' | 'model_error' | 'bad_response' | 'too_many_turns' | 'unauthorized';
