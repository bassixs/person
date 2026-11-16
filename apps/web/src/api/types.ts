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
  };
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
