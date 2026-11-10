export type Source = "tldr" | "tldr_ai" | "twitter" | "manual";
// DB values are the historical "surface"/"deep" strings; the UI presents them
// as "Reference" / "Deep Dive" (see READING_MODE_LABELS in components/ItemCard.tsx).
export type DepthFlag = "surface" | "deep";
export type Status = "pending" | "keep" | "purge";
export type TweetType = "like" | "bookmark";

export interface Topic {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  created_at: string;
  article_count?: number;
}

export interface Article {
  id: string;
  user_id: string;
  source: Source;
  link: string | null;
  headline: string;
  summary: string | null;
  personal_notes: string | null;
  chat_summary: string | null;
  depth_flag: DepthFlag | null;
  status: Status;
  newsletter_date: string | null;
  order_index: number;
  section_label: string | null;
  purged_at: string | null;
  created_at: string;
  updated_at: string;
  tweet_id: string | null;
  tweet_type: TweetType | null;
  tweet_author_name: string | null;
  tweet_author_handle: string | null;
  tweet_author_avatar_url: string | null;
  tweet_posted_at: string | null;
  og_image_url: string | null;
  og_description: string | null;
  domain: string | null;
  extracted_text: string | null;
  topics?: Topic[];
}

export interface TriageUpdate {
  article_id: string;
  status?: Status;
  depth_flag?: DepthFlag | null;
  personal_notes?: string | null;
  chat_summary?: string | null;
}

export interface CaptureInput {
  url: string;
  notes?: string;
  depth_flag?: DepthFlag | null;
  tag_ids?: string[];
}
