import "@fontsource/unbounded/cyrillic-500.css";
import "@fontsource/unbounded/cyrillic-600.css";
import "@fontsource/unbounded/cyrillic-700.css";
import "@fontsource/unbounded/cyrillic-800.css";
import "@fontsource/unbounded/latin-600.css";
import "@fontsource/unbounded/latin-700.css";
import "./report/report.css";

import clsx from "clsx";
import { ArrowDown, ArrowUpRight, Check, CircleDashed, Lock, Sparkles } from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { CharacterScreen } from "./report/CharacterScreen";
import { Deck } from "./report/Deck";
import { PERSONAS } from "./report/personas";

/*
 * Отчёт о проекте в формате сайта (для руководства). Собственный дизайн (E-020).
 * Правило честности: всё, что не сделано, помечено этапом; цифры — из реальных проверок на 16.11.2026.
 */

function useInView<T extends Element>(threshold = 0.2) {
  const ref = useRef<T>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      setShown(true);
      return;
    }
    const io = new IntersectionObserver(
      ([e]) => {
        if (e?.isIntersecting) {
          setShown(true);
          io.disconnect();
        }
      },
      { threshold },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [threshold]);
  return { ref, shown };
}

function Reveal({ children, className, delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  const { ref, shown } = useInView<HTMLDivElement>();
  return (
    <div ref={ref} className={clsx("rp-reveal", className)} data-shown={shown} style={{ transitionDelay: `${delay}ms` }}>
      {children}
    </div>
  );
}

function Head({ kicker, title, lead, center }: { kicker: string; title: ReactNode; lead?: ReactNode; center?: boolean }) {
  return (
    <Reveal className={clsx("mb-12 max-w-3xl sm:mb-16", center && "mx-auto text-center")}>
      <div className="rp-kicker">{kicker}</div>
      <h2 className="rp-display rp-h2 mt-4">{title}</h2>
      {lead && <p className="rp-lead mt-5">{lead}</p>}
    </Reveal>
  );
}

/* ---------- Навигация ---------- */

const ANCHORS = [
  { href: "#characters", label: "Персонажи" },
  { href: "#how", label: "Как работает" },
  { href: "#report", label: "Итоги этапа" },
  { href: "#roadmap", label: "План" },
];

function Nav() {
  const { me } = useAuth();
  return (
    <div className="rp-nav">
      <div className="rp-nav__bar flex items-center gap-4">
        <a href="#top" className="rp-logo">
          ЛИЧНОСТИ
        </a>
        <nav className="mx-auto hidden items-center gap-1 md:flex" aria-label="Разделы отчёта">
          {ANCHORS.map((a) => (
            <a key={a.href} href={a.href} className="rounded-xl px-3 py-2 text-[14px] font-semibold text-[color:var(--ink-2)] transition-colors hover:bg-black/5">
              {a.label}
            </a>
          ))}
        </nav>
        <Link to={me ? "/overview" : "/login"} className="rp-btn ml-auto md:ml-0">
          {me ? "В систему" : "Открыть демо"} <ArrowUpRight className="h-4 w-4" />
        </Link>
      </div>
    </div>
  );
}

/* ---------- 1. Первый экран: выбор персонажа ---------- */

function Hero({ active, setActive }: { active: number; setActive: (i: number) => void }) {
  return (
    <section id="top" className="relative overflow-hidden pb-10 pt-28 sm:pt-32">
      <div className="rp-wrap text-center">
        <div className="rp-kicker">Отчёт о проекте · этап 1 из 5 завершён</div>
        <h1 className="rp-display mx-auto mt-5 max-w-5xl" style={{ fontSize: "clamp(34px, 4.8vw, 72px)" }}>
          Семь персонажей. <span className="text-[color:var(--signal)]">Одна система</span> проверки.
        </h1>
        <p className="rp-lead mx-auto mt-5 max-w-2xl">
          «Личности» помогают сотрудникам быстро разбирать обращения жителей: видеть вопросы разных аудиторий, опираться
          на проверенные факты и готовить честный ответ.
        </p>
      </div>
      <div className="mt-8">
        <Deck personas={PERSONAS} active={active} onChange={setActive} />
      </div>
      <p className="rp-small mt-4 text-center">
        Потяните веер или нажмите на карточку. Ниже — экран выбранного персонажа.
      </p>
    </section>
  );
}

function Characters({ active }: { active: number }) {
  const p = PERSONAS[active]!;
  return (
    <section id="characters" className="rp-section scroll-mt-20 !pt-12">
      <div className="rp-wrap">
        <div className="mb-10 grid gap-6 lg:grid-cols-[1fr_1fr] lg:items-end">
          <div>
            <div className="rp-kicker">Экран персонажа</div>
            <h2 className="rp-display rp-h2 mt-4">
              Персона — это <span className="rp-mark">модель</span>, а не человек
            </h2>
          </div>
          <p className="rp-lead">
            Каждая персона — вымышленная аналитическая модель с паспортом из девяти разделов. Это настоящие семь легенд
            из системы: в них ровно то, что было в исходном описании. Остальное честно отмечено как «неизвестно».
          </p>
        </div>
        <CharacterScreen p={p} />
        <Reveal className="mt-8">
          <div className="flex gap-3 rounded-2xl bg-[color:var(--done)]/10 p-4">
            <Check className="mt-0.5 h-5 w-5 shrink-0 text-[color:var(--done)]" />
            <p className="text-[15px]">
              <b>Для чего:</b> заранее увидеть, какие вопросы материал вызовет у пенсионерки, фермера или человека из
              автосервиса.
            </p>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

/* ---------- 2. Что это ---------- */

const PILLARS = [
  {
    n: "01",
    t: "Веб-студия",
    d: "Редакторы создают и проверяют персоны, темы и источники. Всё с версиями и журналом.",
    tag: "работает",
  },
  {
    n: "02",
    t: "Контекстный центр",
    d: "Темы, документы и факты: у каждого утверждения — источник, дата и статус.",
    tag: "этап 3",
  },
  {
    n: "03",
    t: "Бот в MAX",
    d: "Сотрудник присылает комментарий — получает разбор и черновик ответа.",
    tag: "этап 5",
  },
];

function What() {
  return (
    <section className="rp-section !pt-0">
      <div className="rp-wrap">
        <Head
          kicker="Что это"
          title="Одна платформа вместо чатов, папок и догадок"
          lead="Сайт — для настройки и согласования. MAX — для ежедневной работы. Общий сервер — единственный источник истины."
        />
        <div className="grid gap-4 md:grid-cols-3">
          {PILLARS.map((p, i) => (
            <Reveal key={p.n} delay={i * 100} className="rp-card flex flex-col p-7">
              <div className="flex items-center justify-between">
                <span className="rp-display text-[40px] text-[color:var(--line-strong)]">{p.n}</span>
                <span
                  className={clsx("rp-tag", p.tag === "работает" && "rp-tag--done")}
                  title={p.tag === "работает" ? "Реализовано и проверено" : "Запланировано, в разработке"}
                >
                  {p.tag}
                </span>
              </div>
              <h3 className="rp-h3 mt-8">{p.t}</h3>
              <p className="rp-small mt-2 !text-[15px]">{p.d}</p>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------- 3. Путь персонажа ---------- */

const LEVELS = [
  { t: "Легенда", d: "Короткое описание, неизменяемое", done: true },
  { t: "Черновик паспорта", d: "9 разделов, источник у каждого поля", done: true },
  { t: "Интервью", d: "ИИ задаёт вопросы о пробелах", done: false },
  { t: "Проверка", d: "Противоречия по всему паспорту", done: false },
  { t: "Лаборатория", d: "6 групп испытаний", done: false },
  { t: "Активация", d: "Только без critical", done: false },
];

function Path() {
  const { ref, shown } = useInView<HTMLDivElement>(0.3);
  return (
    <section id="how" className="rp-section scroll-mt-20 !pt-0">
      <div className="rp-wrap">
        <Head
          kicker="Путь персонажа"
          title="От легенды до активной версии — шесть уровней"
          lead="ИИ только предлагает: каждое изменение редактор принимает, правит или отклоняет. Пройти дальше с критической ошибкой нельзя — это проверяет сервер."
        />
        <div ref={ref} data-shown={shown} className="relative">
          <div className="absolute left-[27px] right-[27px] top-[27px] hidden h-1 rounded-full bg-[color:var(--line)] lg:block" />
          <div
            className="rp-path-line absolute left-[27px] right-[27px] top-[27px] hidden h-1 rounded-full bg-[color:var(--done)] lg:block"
            style={{ "--p": 0.2 } as CSSProperties}
          />
          <ol className="relative grid gap-6 sm:grid-cols-2 lg:grid-cols-6">
            {LEVELS.map((l, i) => (
              <li key={l.t} className="flex gap-4 lg:block">
                <span
                  className={clsx(
                    "flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl font-[Unbounded] text-[15px] font-bold",
                    l.done ? "bg-[color:var(--done)] text-white" : "border-2 border-dashed border-[color:var(--line-strong)] bg-[color:var(--paper)] text-[color:var(--muted)]",
                  )}
                >
                  {l.done ? <Check className="h-6 w-6" /> : <Lock className="h-5 w-5" />}
                </span>
                <div className="lg:mt-5">
                  <div className="rp-kicker">Уровень {i + 1}</div>
                  <div className="rp-h3 mt-1.5">{l.t}</div>
                  <p className="rp-small mt-1">{l.d}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}

/* ---------- 4. Ежедневный сценарий ---------- */

function Chat() {
  const { ref, shown } = useInView<HTMLDivElement>(0.3);
  const gray = "rp-msg rounded-[20px] bg-white/[0.07] px-4 py-3 text-[14.5px] leading-snug";
  return (
    <div ref={ref} className="rp-chat rp-card p-4 sm:p-5" data-shown={shown}>
      <div className="flex items-center justify-between border-b border-[color:var(--line)] pb-3">
        <span className="text-[14px] font-bold">Личности · бот в MAX</span>
        <span className="rp-tag" title="Запланировано, в разработке">
          макет · этап 5
        </span>
      </div>
      <div className="mt-4 space-y-3">
        {/* 1. Комментарий жителя, который прислал сотрудник */}
        <div className={clsx(gray, "max-w-[90%] rounded-bl-md")} style={{ "--d": "200ms" } as CSSProperties}>
          <div className="rp-kicker mb-1.5">Комментарий жителя</div>
          «Опять запреты. У нас только запрещать и умеют. Курю я или нет — моё личное дело, я взрослый человек»
        </div>
        {/* 2. Разбор */}
        <div className={clsx(gray, "max-w-[96%] rounded-bl-md")} style={{ "--d": "1100ms" } as CSSProperties}>
          <div className="rp-kicker mb-2">Разбор · тема «Ограничение продажи вейпов»</div>
          <div className="space-y-1.5">
            <div className="flex gap-2">
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#4ade80]" /> Ограничили продажу, а не курение взрослых —
              региональный закон
            </div>
            <div className="flex gap-2 text-[color:var(--muted)]">
              <Sparkles className="mt-0.5 h-4 w-4 shrink-0" /> Главное раздражение: «запрещают мой личный выбор»
            </div>
          </div>
          <div className="rp-kicker mb-2 mt-4">Как прочитают ответ · взгляд персон</div>
          <ul className="space-y-1.5 text-[color:var(--ink-2)]">
            <li>
              <b className="text-[color:var(--ink)]">Артём:</b> запреты раздражают, но за детей поддержит → сразу сказать «вам
              никто не запрещает»
            </li>
            <li>
              <b className="text-[color:var(--ink)]">Любовь:</b> главное — школьники → про них
            </li>
            <li>
              <b className="text-[color:var(--ink)]">Вадим:</b> не любит пафос → коротко, без морали
            </li>
          </ul>
        </div>
        {/* 3. Черновик ответа — живым языком; публикует сотрудник, редактор проверяет */}
        <div
          className="rp-msg ml-auto max-w-[88%] rounded-[20px] rounded-br-md bg-[color:var(--signal)] px-4 py-3 text-[15px] leading-snug text-white"
          style={{ "--d": "2200ms" } as CSSProperties}
        >
          <div className="mb-1.5 text-[11px] font-bold uppercase tracking-[0.1em] text-white/75">Черновик ответа</div>
          Взрослым курить никто не запрещает — это ваше дело. Ограничили продажу из-за школьников: курят у школы, а дудки эти
          уже из рук не выпускают.
        </div>
      </div>
    </div>
  );
}

const STEPS = [
  ["Материал", "Комментарий, ссылка, скриншот или сразу пачка обращений."],
  ["Контекст", "Система предлагает тему — сотрудник подтверждает."],
  ["Разбор", "Что на самом деле произошло, что злит человека и как ответ прочитают разные люди."],
  ["Ответ", "Короткий живой ответ, который снимает негатив, — от сотрудника под своим именем."],
];

function Daily() {
  return (
    <section className="rp-section rp-night">
      <div className="rp-wrap grid items-center gap-14 lg:grid-cols-2">
        <div>
          <div className="rp-kicker">Ежедневная работа</div>
          <h2 className="rp-display rp-h2 mt-4">От комментария до ответа — в одном чате</h2>
          <ol className="mt-10 space-y-1">
            {STEPS.map(([t, d], i) => (
              <Reveal key={t} delay={i * 90} className="flex gap-5 border-t border-[color:var(--line)] py-4">
                <span className="font-[Unbounded] text-[13px] font-bold text-[color:var(--signal)]">0{i + 1}</span>
                <div>
                  <div className="text-[17px] font-bold">{t}</div>
                  <p className="rp-small mt-0.5 !text-[15px]">{d}</p>
                </div>
              </Reveal>
            ))}
          </ol>
        </div>
        <Reveal delay={120}>
          <Chat />
        </Reveal>
      </div>
    </section>
  );
}

/* ---------- 5. Контроль качества ---------- */

const LAB = [
  ["Биография", "события не противоречат друг другу", "pass"],
  ["Характер", "черты устойчивы", "pass"],
  ["Компетенции", "нет придуманной экспертизы", "warning"],
  ["Восприятие", "вопросы согласованы", "pass"],
  ["Речь", "стиль стабилен", "pass"],
  ["Неопределённость", "говорит «неизвестно»", "pass"],
] as const;

function Control() {
  const { ref, shown } = useInView<HTMLDivElement>(0.3);
  return (
    <section className="rp-section">
      <div className="rp-wrap">
        <Head
          kicker="Контроль качества"
          title={
            <>
              ИИ предлагает. <span className="text-[color:var(--signal)]">Решает человек.</span>
            </>
          }
          lead="ИИ не может молча изменить паспорт или факт. Перед запуском персона проходит шесть групп испытаний, а итог каждого — понятный pass, warning или critical."
        />
        <div className="grid gap-5 lg:grid-cols-2">
          <Reveal className="rp-card flex flex-col p-6 sm:p-7">
            <div className="flex items-center justify-between">
              <span className="rp-h3">Предложение ИИ</span>
              <span className="rp-tag" title="Запланировано, в разработке">
                этап 2
              </span>
            </div>
            <div className="mt-7 space-y-3">
              <div className="rp-kicker">Раздел «Компетенции»</div>
              <div className="rp-display text-[clamp(22px,2.2vw,30px)]">
                <span className="rp-strike">Профессия: автомеханик</span>
              </div>
              <div className="rp-appear rp-display border-l-4 border-[color:var(--done)] pl-3 text-[clamp(22px,2.2vw,30px)]">
                Профессия: неизвестно
              </div>
            </div>
            <p className="rp-small mt-5 !text-[15px]">
              Причина: противоречие с разделом «Опыт» — редактор указал, что гараж для персонажа хобби, а не работа.
            </p>
            <div className="mt-auto flex flex-wrap gap-2 pt-6">
              <span className="rp-btn !h-11">Принять</span>
              <span className="rp-btn rp-btn--ghost !h-11">Изменить</span>
              <span className="rp-btn rp-btn--ghost !h-11">Отклонить</span>
            </div>
          </Reveal>
          <Reveal delay={120}>
            <div ref={ref} data-shown={shown} className="rp-lab rp-card h-full p-6 sm:p-7">
              <div className="flex items-center justify-between">
                <span className="rp-h3">Лаборатория перед запуском</span>
                <span className="rp-tag" title="Запланировано, в разработке">
                  этап 2
                </span>
              </div>
              <ul className="mt-5">
                {LAB.map(([t, d, s], i) => (
                  <li key={t} className="flex items-center justify-between gap-3 border-t border-[color:var(--line)] py-3">
                    <div className="min-w-0">
                      <div className="text-[15px] font-bold">{t}</div>
                      <div className="rp-small truncate !text-[13px]">{d}</div>
                    </div>
                    <span
                      className={clsx("rp-lab__st rp-tag", s === "pass" ? "rp-tag--done" : "border-[#d99a00] bg-[#ffc94a] text-[#4a3300]")}
                      style={{ "--i": i } as CSSProperties}
                    >
                      {s}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="rp-small mt-4 !text-[14px]">
                <b className="text-[color:var(--ink)]">Critical</b> блокирует запуск на сервере. Никаких «готовность 93%» —
                только объяснимые результаты.
              </p>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

/* ---------- 6. Итоги этапа 1 ---------- */

const METRICS = [
  { n: "28", t: "автотестов сервера", d: "на настоящей базе PostgreSQL" },
  { n: "15", t: "тестов интерфейса", d: "включая правила демо-режима" },
  { n: "1", t: "сквозной сценарий", d: "вход → создание → сохранение → перезагрузка" },
  { n: "4", t: "роли с правами", d: "редактор, автор, оператор, администратор" },
  { n: "9/31", t: "разделов / полей паспорта", d: "у каждого поля — источник и уверенность" },
  { n: "7", t: "легенд в системе", d: "загружены как черновики" },
];

const DONE = [
  "Вход по паролю, защищённые сессии, роли и права — на сервере",
  "Каталог личностей: поиск, фильтры, архив, создание",
  "Рабочая карточка: 9 разделов паспорта, сохранение без потери правок",
  "Версии: активная неизменяема, защита на уровне базы данных",
  "Журнал действий, включая отклонённые попытки запуска",
  "Барьер активации: без проверок запустить персону нельзя",
  "Автопроверка кода (CI) и демо-версия в браузере",
];

const NOT_DONE = [
  "ИИ, веб-поиск и MAX не подключены — нужны ключи; система честно пишет «не подключено»",
  "Ни одна персона не активирована — для этого нужен этап 2",
  "Запуск через Docker на сервере ещё не проверялся",
];

function Report() {
  return (
    <section id="report" className="rp-section scroll-mt-20 bg-[color:var(--paper-2)]">
      <div className="rp-wrap">
        <Head kicker="Итоги этапа 1" title="Фундамент построен и проверен" lead="Цифры ниже — результаты реальных прогонов, а не планы." />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          {METRICS.map((m, i) => (
            <Reveal key={m.t} delay={(i % 3) * 80} className="rp-card p-5 sm:p-7">
              <div className="rp-display text-[clamp(40px,5vw,72px)]">{m.n}</div>
              <div className="mt-3 text-[15px] font-bold">{m.t}</div>
              <div className="rp-small mt-1">{m.d}</div>
            </Reveal>
          ))}
        </div>
        <div className="mt-6 grid gap-5 lg:grid-cols-[1.4fr_1fr]">
          <Reveal className="rp-card p-6 sm:p-7">
            <div className="rp-h3">Сделано</div>
            <ul className="mt-4 space-y-3">
              {DONE.map((d) => (
                <li key={d} className="flex gap-3 text-[15px]">
                  <Check className="mt-0.5 h-5 w-5 shrink-0 text-[color:var(--done)]" /> {d}
                </li>
              ))}
            </ul>
          </Reveal>
          <Reveal delay={120} className="rp-card p-6 sm:p-7">
            <div className="rp-h3">Пока нет</div>
            <ul className="mt-4 space-y-3">
              {NOT_DONE.map((d) => (
                <li key={d} className="flex gap-3 text-[15px]">
                  <CircleDashed className="mt-0.5 h-5 w-5 shrink-0 text-[color:var(--muted)]" /> {d}
                </li>
              ))}
            </ul>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

/* ---------- 7. План ---------- */

const ROADMAP: { n: number; t: string; d: string; state: "done" | "next" | "later" }[] = [
  { n: 1, t: "Фундамент", d: "Вход, роли, каталог, паспорт, версии, журнал", state: "done" },
  { n: 2, t: "Студия персон", d: "Интервью, предложения ИИ, проверка, лаборатория, активация", state: "next" },
  { n: 3, t: "Контекстный центр", d: "Темы, документы, источники, факты со статусами", state: "later" },
  { n: 4, t: "Мониторинг и навыки", d: "Слежение за важными темами, восемь ИИ-навыков", state: "later" },
  { n: 5, t: "Задания и MAX", d: "Бот для сотрудников, пакетный анализ, пилот", state: "later" },
];

function Roadmap() {
  return (
    <section id="roadmap" className="rp-section scroll-mt-20">
      <div className="rp-wrap">
        <Head kicker="План" title="Пять этапов до пилота" lead="Каждый этап — работающая часть системы с базой, правами и тестами." />
        <ol className="grid gap-3 md:grid-cols-5">
          {ROADMAP.map((r, i) => (
            <Reveal
              key={r.n}
              delay={i * 80}
              className={clsx(
                "rp-card flex min-h-[220px] flex-col p-5",
                r.state === "done" && "!border-[color:var(--done)] !bg-[color:var(--done)] text-white",
                r.state === "next" && "!border-[color:var(--signal)] !border-2",
              )}
            >
              <span className={clsx("rp-display text-[34px]", r.state === "later" && "text-[color:var(--line-strong)]")}>0{r.n}</span>
              <div className="mt-auto">
                <div className={clsx("text-[12px] font-bold uppercase tracking-[0.08em]", r.state === "done" ? "text-white/80" : r.state === "next" ? "text-[color:var(--signal)]" : "text-[color:var(--muted)]")}>
                  {r.state === "done" ? "готово" : r.state === "next" ? "в работе" : "запланировано"}
                </div>
                <div className="rp-h3 mt-2">{r.t}</div>
                <p className={clsx("mt-1.5 text-[13.5px] leading-snug", r.state === "done" ? "text-white/80" : "text-[color:var(--muted)]")}>{r.d}</p>
              </div>
            </Reveal>
          ))}
        </ol>
      </div>
    </section>
  );
}

/* ---------- 8. Что нужно ---------- */

const NEEDS = [
  { t: "Сервер", d: "VPS: 2 ГБ памяти, 30 ГБ диска — для общей рабочей версии команды." },
  { t: "Языковая модель", d: "Доступ к ИИ-провайдеру, работающему из российской инфраструктуры. Без него этап 2 работает только на заглушках." },
  { t: "Бот в MAX", d: "Регистрация бота и токен — к пятому этапу." },
  { t: "Решения", d: "Кто отправляет на согласование, кто архивирует, что такое «область доступа» автора." },
];

function Needs() {
  return (
    <section className="rp-section rp-night">
      <div className="rp-wrap">
        <Head kicker="Что нужно от руководства" title="Четыре шага, чтобы двигаться дальше" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {NEEDS.map((x, i) => (
            <Reveal key={x.t} delay={i * 90} className="rp-card p-6">
              <span className="font-[Unbounded] text-[13px] font-bold text-[color:var(--signal)]">0{i + 1}</span>
              <div className="rp-h3 mt-6">{x.t}</div>
              <p className="rp-small mt-2 !text-[15px]">{x.d}</p>
            </Reveal>
          ))}
        </div>
        <div className="mt-16 flex flex-col items-center gap-6 border-t border-[color:var(--line)] pt-14 text-center">
          <h2 className="rp-display rp-h2 max-w-3xl">Демо уже можно открыть и потрогать</h2>
          <p className="rp-lead max-w-xl">Каталог, паспорт, версии и барьер запуска. Данные демо хранятся только в вашем браузере.</p>
          <div className="flex flex-wrap justify-center gap-3">
            <Link to="/login" className="rp-btn">
              Открыть демо <ArrowUpRight className="h-4 w-4" />
            </Link>
            <a href="#top" className="rp-btn rp-btn--ghost">
              Наверх <ArrowDown className="h-4 w-4 rotate-180" />
            </a>
          </div>
          <p className="rp-small max-w-lg">
            Персоны вымышлены и служат только для внутреннего анализа. Публичные ответы — только от имени ведомства, с
            прозрачным авторством.
          </p>
        </div>
      </div>
    </section>
  );
}

export function ReportPage() {
  const [active, setActive] = useState(3);
  useEffect(() => {
    const prev = document.title;
    document.title = "Личности — отчёт о проекте";
    return () => {
      document.title = prev;
    };
  }, []);
  return (
    <div className="rp">
      <Nav />
      <main>
        <Hero active={active} setActive={setActive} />
        <Characters active={active} />
        <What />
        <Path />
        <Daily />
        <Control />
        <Report />
        <Roadmap />
        <Needs />
      </main>
    </div>
  );
}
