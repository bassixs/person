import {
  Activity,
  BookOpen,
  Cat,
  Compass,
  Fingerprint,
  Fish,
  Footprints,
  GraduationCap,
  MessageCircle,
  Mountain,
  ScrollText,
  ShieldQuestion,
  Sprout,
  Tractor,
  Users,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import fixtures from "../../demo/fixtures.json";

/*
 * Данные персонажей — настоящие семь легенд из backend (seed_data.py → fixtures.json).
 * Все они — ЧЕРНОВИКИ: ни одна персона не активирована (этап 2). Заполненность считается по реальным полям.
 * Внешность — условная иллюстрация, а не «портрет» (персоны вымышлены).
 */

type Field = { value: unknown; source_kind: string; certainty: string };
type Seed = {
  name: string;
  short_context: string;
  passport: { sections: Record<string, { fields: Record<string, Field> }> };
};
type SchemaSection = { key: string; title: string; fields: { key: string; label: string }[] };

const schema = (fixtures as unknown as { schema: { sections: SchemaSection[] } }).schema;
const seeds = (fixtures as unknown as { seed: Seed[] }).seed;

export type Hair = "short" | "bob" | "bun" | "long" | "curly" | "cap";
export interface Look {
  c1: string;
  c2: string;
  skin: string;
  hair: Hair;
  hairColor: string;
  beard?: boolean;
  glasses?: boolean;
  icon: LucideIcon;
  role: string;
}

/** Визуальная «сборка» персонажа — порядок совпадает с seed. */
const LOOKS: Look[] = [
  { c1: "#3d6bff", c2: "#1b2f7a", skin: "#e2b493", hair: "short", hairColor: "#3a2a20", beard: true, icon: Fish, role: "Практик" },
  { c1: "#2fae64", c2: "#0f4d2b", skin: "#efcdb4", hair: "bun", hairColor: "#c9c4bb", icon: Sprout, role: "Хозяйка дачи" },
  { c1: "#a64dff", c2: "#43176e", skin: "#f0c9ad", hair: "bob", hairColor: "#8a3b22", icon: Cat, role: "Домашний уют" },
  { c1: "#f2a516", c2: "#7a4a06", skin: "#d4a07e", hair: "cap", hairColor: "#4a3626", beard: true, icon: Tractor, role: "Фермер" },
  { c1: "#13a8a0", c2: "#08504c", skin: "#e8bf9f", hair: "long", hairColor: "#2b1d16", icon: Mountain, role: "Между городом и деревней" },
  { c1: "#ff5a1f", c2: "#7a1f04", skin: "#d9a687", hair: "short", hairColor: "#1e1a17", icon: Wrench, role: "Автосервис" },
  { c1: "#5b5ff0", c2: "#23246b", skin: "#ecc4a6", hair: "curly", hairColor: "#2a2420", glasses: true, icon: BookOpen, role: "Книги и история" },
];

export const SECTION_ICONS: Record<string, LucideIcon> = {
  legend: ScrollText,
  family: Users,
  experience: Footprints,
  character: Fingerprint,
  worldview: Compass,
  competence: GraduationCap,
  speech: MessageCircle,
  behavior: Activity,
  limits: ShieldQuestion,
};

export interface SlotField {
  key: string;
  label: string;
  value: string | null;
  fromLegend: boolean;
}
export interface Slot {
  key: string;
  title: string;
  fields: SlotField[];
  filled: number;
}
export interface Persona {
  id: number;
  name: string;
  context: string;
  look: Look;
  slots: Slot[];
  known: number;
  total: number;
  age: string | null;
}

const fmt = (v: unknown): string | null => {
  if (v === null || v === undefined || v === "") return null;
  if (Array.isArray(v)) return v.length ? v.join(", ") : null;
  return String(v);
};

export const PERSONAS: Persona[] = seeds.map((s, id) => {
  const slots: Slot[] = schema.sections.map((sec) => {
    const fields = sec.fields.map((f) => {
      const raw = s.passport.sections[sec.key]?.fields[f.key];
      const value = fmt(raw?.value);
      return { key: f.key, label: f.label, value, fromLegend: raw?.source_kind === "original_legend" && value !== null };
    });
    return { key: sec.key, title: sec.title, fields, filled: fields.filter((f) => f.value !== null).length };
  });
  const total = slots.reduce((a, x) => a + x.fields.length, 0);
  const known = slots.reduce((a, x) => a + x.filled, 0);
  const age = slots[0]?.fields.find((f) => f.key === "age_range")?.value ?? null;
  return { id, name: s.name, context: s.short_context, look: LOOKS[id % LOOKS.length]!, slots, known, total, age };
});
