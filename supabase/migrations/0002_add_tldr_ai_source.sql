-- Distinguish TLDR from TLDR AI newsletters (same sender, different subject line)

alter table articles drop constraint articles_source_check;

alter table articles add constraint articles_source_check
  check (source in ('tldr', 'tldr_ai', 'twitter', 'manual'));
