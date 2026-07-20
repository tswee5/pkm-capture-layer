export type Source = "tldr" | "tldr_ai" | "twitter" | "manual";
export type DepthFlag = "surface" | "deep";
export type Status = "pending" | "keep" | "purge";

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
  topics?: Topic[];
}

export interface TriageUpdate {
  article_id: string;
  status?: Status;
  depth_flag?: DepthFlag | null;
  personal_notes?: string | null;
  chat_summary?: string | null;
}

export interface UploadArticleInput {
  url: string;
  title?: string;
  source_label?: string;
}
