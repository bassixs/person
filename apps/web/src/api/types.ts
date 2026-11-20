export type Role = "admin" | "editor" | "author" | "operator";

export interface Me {
  id: string;
  email: string;
  display_name: string;
  roles: Role[];
  permissions: string[];
  csrf_token: string;
}

export interface UserRef {
  id: string;
  display_name: string;
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
}

export type PersonaStatus =
  | "draft"
  | "pending_approval"
  | "active"
  | "needs_revision"
  | "suspended"
  | "archived";

export interface VersionRef {
  id: string;
  label: string;
  state: "draft" | "active" | "superseded" | "suspended";
  content_hash: string;
  revision: number;
}

export interface PersonaListItem {
  id: string;
  display_name: string;
  short_context: string;
  status: PersonaStatus;
  creation_mode: "manual" | "legend" | "ai_draft";
  is_seed: boolean;
  created_by: UserRef | null;
  created_at: string;
  updated_at: string;
  active_version: VersionRef | null;
  draft_version: VersionRef | null;
  completeness: { fields_filled: number; fields_total: number } | null;
  open_issues: number | null;
}

export interface VersionSummary extends VersionRef {
  created_at: string;
  updated_at: string;
  created_by: UserRef | null;
  approved_at: string | null;
}

export interface PersonaDetail extends PersonaListItem {
  versions: VersionSummary[];
  source_materials: { id: string; kind: string; content: string; created_at: string }[];
  capabilities: {
    can_edit: boolean;
    can_archive: boolean;
    can_activate: boolean;
    can_create_version: boolean;
    can_suspend?: boolean;
  };
  pending_proposals: number;
  ai_configured: boolean;
}

// ---------- Итерация 2: интервью и предложения ИИ ----------

export type AnswerKind = "answered" | "unknown" | "skipped";

export interface InterviewQuestion {
  id: string;
  round_no: number;
  position: number;
  question: string;
  why: string;
  field_paths: string[];
  answer_kind: AnswerKind | null;
  answer_text: string | null;
  answered_at: string | null;
}

export interface Interview {
  id: string;
  version_id: string;
  status: "active" | "completed";
  rounds: number;
  created_at: string;
  completed_at: string | null;
  created_by: UserRef | null;
  questions: InterviewQuestion[];
}

export type ProposalStatus = "pending" | "accepted" | "rejected" | "stale";

export interface Proposal {
  id: string;
  version_id: string;
  origin: "interview" | "deepen" | string;
  interview_session_id: string | null;
  field_path: string;
  before_value: string | string[] | null;
  proposed_value: string | string[];
  proposed_certainty: "defined" | "hypothesis";
  rationale: string;
  related_paths: string[];
  base_content_hash: string;
  status: ProposalStatus;
  edited_value: string | string[] | null;
  edited_certainty: string | null;
  decision_note: string | null;
  stale_reason: string | null;
  generator: { model?: string; skill?: string; version?: string };
  created_by: UserRef | null;
  decided_by: UserRef | null;
  created_at: string;
  decided_at: string | null;
}

export interface DecisionOut {
  proposal: Proposal;
  revision: number;
  content_hash: string;
}

export type SourceKind = "original_legend" | "editor" | "ai_suggestion";
export type Certainty = "defined" | "hypothesis" | "unknown";
export type FieldType = "text" | "longtext" | "tags";

export interface PassportField {
  value: string | string[] | null;
  source_kind: SourceKind;
  certainty: Certainty;
  editor_approved: boolean;
  dependencies: string[];
}

export interface PassportSection {
  fields: Record<string, PassportField>;
  narrative: string;
}

export interface Passport {
  schema_version: number;
  sections: Record<string, PassportSection>;
}

export interface SectionCompleteness {
  fields_total: number;
  fields_filled: number;
  has_narrative: boolean;
  hypotheses: number;
}

export interface VersionDetail extends VersionSummary {
  persona_id: string;
  schema_version: number;
  passport: Passport;
  completeness: {
    fields_total: number;
    fields_filled: number;
    sections: Record<string, SectionCompleteness>;
  };
  updated_by: UserRef | null;
}

export interface SchemaField {
  key: string;
  label: string;
  type: FieldType;
  hint: string;
}

export interface PassportSchema {
  schema_version: number;
  source_kinds: Record<SourceKind, string>;
  certainties: Record<Certainty, string>;
  sections: { key: string; title: string; description: string; fields: SchemaField[] }[];
}

export interface IntegrationStatus {
  name: "llm" | "search" | "max";
  title: string;
  status: "configured" | "not_configured";
  verified: boolean;
  detail: Record<string, string | null>;
  how_to_connect: string;
  ok?: boolean;
  error?: string | null;
  latency_ms?: number;
}

export interface AuditEvent {
  id: string;
  occurred_at: string;
  actor: UserRef | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  entity_version: string | null;
  details: Record<string, unknown>;
}

export interface Overview {
  personas: {
    total: number;
    by_status: Partial<Record<PersonaStatus, number>>;
    with_active_version: number;
  } | null;
  topics: { available: boolean; iteration: number };
  tasks: { available: boolean; iteration: number };
  monitoring: { available: boolean; iteration: number };
  proposals: { available: boolean; iteration: number };
  recent_events: AuditEvent[];
  integrations: IntegrationStatus[];
}

export interface UserOut {
  id: string;
  email: string;
  display_name: string;
  roles: Role[];
  is_active: boolean;
  created_at: string;
}

export interface ActivationCheck {
  version_id: string;
  content_hash: string;
  can_activate_by_role: boolean;
  blockers: { code: string; message: string }[];
}

// ---------- Итерация 2: проверка целостности и «светофор» ----------

export interface ValidationIssue {
  id: string;
  severity: "critical" | "warning" | "info";
  kind: "contradiction" | "unspecified" | "unusual_compatible";
  title: string;
  explanation: string;
  field_paths: string[];
  suggestion: string | null;
  fix_field_path: string | null;
  fix_value: string | string[] | null;
  proposal_id: string | null;
}

export interface ValidationRun {
  id: string;
  version_id: string;
  content_hash: string;
  kind: "check" | "final";
  status: "queued" | "running" | "done" | "failed";
  model: string | null;
  summary: string | null;
  critical_count: number;
  warning_count: number;
  info_count: number;
  error: string | null;
  started_by: UserRef | null;
  created_at: string;
  finished_at: string | null;
  issues: ValidationIssue[];
  is_current: boolean;
}

export interface ConsistencySignal {
  status: "ready" | "pending" | "unavailable";
  level: "green" | "yellow" | "red" | "unavailable" | "error" | null;
  p_conflict: number | null;
  severity: string | null;
  model: string | null;
  content_hash: string | null;
}

// ---------- Итерация 2: лаборатория ----------

export type Verdict = "pass" | "warning" | "critical";

export interface LabResult {
  id: string;
  lab_group: string;
  case_key: string;
  prompt: string;
  response: string;
  verdict: Verdict;
  confidence: number | null;
  explanation: string | null;
  suggestion: string | null;
}

export interface LabRun {
  id: string;
  version_id: string;
  content_hash: string;
  suite_version: string;
  status: "queued" | "running" | "done" | "failed";
  models: { simulator?: string; judge?: string; explainer?: string };
  pass_count: number;
  warning_count: number;
  critical_count: number;
  error: string | null;
  started_by: UserRef | null;
  created_at: string;
  finished_at: string | null;
  results: LabResult[];
  is_current: boolean;
  version_label: string | null;
}

export interface LabOverview {
  suite_version: string;
  groups: { key: string; title: string; goal: string; cases: { key: string; prompt: string }[] }[];
  runs: LabRun[];
  baseline: LabRun | null;
}

// ---------- итерация 3: темы ----------

export type TopicStatus = "draft" | "under_review" | "active" | "needs_update" | "suspended" | "archived";
export type ClaimStatus = "unverified" | "verified" | "disputed" | "refuted" | "stale";
export type ClaimKind = "operational" | "stable";

export interface ClaimSource {
  title: string;
  url: string | null;
  quote: string | null;
  location: string | null;
  knowledge_item_id?: string | null;
}

export interface Claim {
  id: string;
  text: string;
  status: ClaimStatus;
  kind: ClaimKind;
  event_date: string | null;
  published_at: string | null;
  checked_at: string | null;
  valid_from: string | null;
  valid_until: string | null;
  sources: ClaimSource[];
  origin: "editor" | "ai_suggestion" | "monitoring" | "task";
  note: string;
}

export interface Dossier {
  summary: string;
  background: string;
  territory: string;
  timeframe: string;
  participants: string[];
  claims: Claim[];
  residents_questions: string[];
  faq: { question: string; answer: string }[];
  unknowns: string[];
  conflicts: string[];
}

export interface TopicVersionRef {
  id: string;
  label: string;
  state: string;
  content_hash: string;
  revision: number;
}

export interface ClaimFlag {
  id: string;
  claim_id: string;
  version_id: string;
  flag: "refuted" | "disputed" | "stale" | "cleared";
  reason: string;
  origin: string;
  created_by: UserRef | null;
  created_at: string;
}

export interface TopicListItem {
  id: string;
  title: string;
  geography: string;
  category: string;
  status: TopicStatus;
  creation_mode: string;
  active_version: TopicVersionRef | null;
  draft_version: TopicVersionRef | null;
  counts: { claims: number; verified: number; unsafe: number; open_questions: number } | null;
  created_by: UserRef | null;
  created_at: string;
  updated_at: string;
}

export interface TopicVersionSummary {
  id: string;
  label: string;
  state: string;
  content_hash: string;
  change_note: string;
  created_by: UserRef | null;
  approved_by: UserRef | null;
  created_at: string;
  approved_at: string | null;
}

export interface TopicDetail extends TopicListItem {
  versions: TopicVersionSummary[];
  capabilities: {
    can_edit: boolean;
    can_submit: boolean;
    can_activate: boolean;
    can_archive: boolean;
    can_flag: boolean;
    can_verify_claims: boolean;
  };
  flags: ClaimFlag[];
}

export interface EffectiveClaim {
  id: string;
  effective_status: ClaimStatus;
  safe_to_use: boolean;
  flag: ClaimFlag | null;
}

export interface TopicVersionDetail extends TopicVersionSummary {
  topic_id: string;
  revision: number;
  schema_version: number;
  dossier: Dossier;
  claims_effective: EffectiveClaim[];
  updated_by: UserRef | null;
  updated_at: string;
}

export interface TopicCheck {
  version_id: string;
  content_hash: string;
  blockers: { code: string; message: string }[];
  warnings: { code: string; message: string }[];
}

export interface ClaimHistoryEntry {
  kind: "version" | "flag";
  at: string;
  version_label: string | null;
  version_state: string | null;
  text: string | null;
  status: ClaimStatus | null;
  valid_until: string | null;
  flag: string | null;
  reason: string | null;
  actor: UserRef | null;
}

// ---------- итерация 3: база знаний и источники ----------

export type ExtractionStatus = "ok" | "partial" | "failed" | "unsupported";

export interface KnowledgeItem {
  id: string;
  title: string;
  kind: "file" | "url" | "text";
  layer: "global" | "topic";
  format: string;
  mime: string;
  filename: string | null;
  size_bytes: number | null;
  url: string | null;
  final_url: string | null;
  source: { id: string; name: string; url: string | null } | null;
  topics: { id: string; title: string }[];
  text_chars: number;
  extraction_status: ExtractionStatus;
  extraction_note: string;
  pages_total: number | null;
  pages_with_text: number | null;
  published_at: string | null;
  has_file: boolean;
  created_by: UserRef | null;
  created_at: string;
  archived_at: string | null;
}

export interface KnowledgeItemDetail extends KnowledgeItem {
  text: string;
}

export interface SearchHit {
  item: KnowledgeItem;
  rank: number;
  excerpt: string;
}

export interface SourceOut {
  id: string;
  name: string;
  url: string | null;
  kind: string;
  geography: string;
  topics: string;
  access_method: string;
  access_notes: string;
  priority: number;
  check_interval: string;
  status: "active" | "disabled";
  last_checked_at: string | null;
  last_ok_at: string | null;
  last_error: string | null;
  items_count: number;
  created_by: UserRef | null;
  created_at: string;
  updated_at: string;
}

export interface SourceFetchOut {
  id: string;
  purpose: string;
  ok: boolean;
  http_status: number | null;
  final_url: string | null;
  bytes: number | null;
  duration_ms: number | null;
  error: string | null;
  knowledge_item_id: string | null;
  created_at: string;
}
