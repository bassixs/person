import clsx from "clsx";
import {
  ArrowRight,
  BookOpenCheck,
  Check,
  CircleHelp,
  Clock3,
  Eye,
  FileStack,
  FlaskConical,
  GitBranch,
  History,
  Layers,
  Lock,
  MessageSquareText,
  Radar,
  ShieldCheck,
  Sparkles,
  UserRoundCog,
  X,
} from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Ambient, useAmbient } from "../components/Ambient";
import { LogoMark, Wordmark } from "../components/Logo";
import { useAuth } from "../lib/auth";

/*
 * Презентационная страница для руководства. Правило: страница не обещает того, чего нет.
 * Каждая возможность помечена реальным статусом (см. README «Состояние» и PROJECT_CONTEXT §18).
 */

type Stage = "done" | 2 | 3 | 4 | 5;

const STAGE_TEXT: Record<string, string> = {
  done: "Работает",
  2: "Этап 2",
  3: "Этап 3",
  4: "Этап 4",
  5: "Этап 5",
};

function StageBadge({ stage }: { stage: Stage }) {
  const done = stage === "done";
  return (
    <span
      className={clsx(
        "chip shrink-0 font-mono text-[10.5px] uppercase tracking-[0.08em]",
        done ? "border-success/40 bg-success/10 text-success" : "border-line-strong bg-elevated/60 text-muted",
      )}
      title={done ? "Реализовано и проверено" : "Запланировано, в разработке"}
    >
      {done ? <Check className="h-3 w-3" /> : <Clock3 className="h-3 w-3" />}
      {STAGE_TEXT[String(stage)]}
    </span>
  );
}

/* ---------- Появление при прокрутке ---------- */

function useInView<T extends Element>(threshold = 0.18) {
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
      ([entry]) => {
        if (entry?.isIntersecting) {
          setShown(true);
          io.disconnect();
        }
      },
      { threshold, rootMargin: "0px 0px -8% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [threshold]);
  return { ref, shown };
}

function Reveal({
  children,
  delay = 0,
  className,
  as: Tag = "div",
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
  as?: "div" | "li" | "section";
}) {
  const { ref, shown } = useInView<HTMLDivElement>();
  return (
    <Tag
      ref={ref as never}
      className={clsx("reveal", className)}
      data-shown={shown}
      style={{ transitionDelay: `${delay}ms` }}
    >
      {children}
    </Tag>
  );
}

function CountUp({ to, duration = 1200 }: { to: number; duration?: number }) {
  const { ref, shown } = useInView<HTMLSpanElement>(0.6);
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!shown) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setN(to);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / duration);
      setN(Math.round(to * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [shown, to, duration]);
  return <span ref={ref}>{n}</span>;
}

function SectionHead({ kicker, title, lead }: { kicker: string; title: ReactNode; lead?: ReactNode }) {
  return (
    <Reveal className="mx-auto mb-10 max-w-3xl text-center sm:mb-14">
      <div className="label-mono text-accent">{kicker}</div>
      <h2 className="mt-3 text-balance text-[28px] font-bold leading-tight tracking-tight text-fg sm:text-4xl">{title}</h2>
      {lead && <p className="mt-4 text-pretty text-base leading-relaxed text-muted sm:text-lg">{lead}</p>}
    </Reveal>
  );
}

/* ---------- Верхняя панель страницы ---------- */

const ANCHORS = [
  { href: "#value", label: "Ценность" },
  { href: "#scenario", label: "Сценарий" },
  { href: "#control", label: "Контроль" },
  { href: "#roadmap", label: "План" },
];

function AboutNav() {
  const { me } = useAuth();
  return (
    <header
      className="fixed inset-x-0 top-0 z-40 border-b border-line/80 bg-canvas/70 backdrop-blur-xl"
      style={{ height: "var(--nav-height)" }}
    >
      <div className="shell flex h-full items-center gap-4">
        <a href="#top" className="shrink-0 rounded-ui" aria-label="К началу">
          <Wordmark />
        </a>
        <nav className="mx-auto hidden items-center gap-1 md:flex" aria-label="Разделы презентации">
          {ANCHORS.map((a) => (
            <a key={a.href} href={a.href} className="rounded-ui px-3 py-1.5 text-sm font-medium text-muted transition-colors hover:text-fg">
              {a.label}
            </a>
          ))}
        </nav>
        <Link to={me ? "/overview" : "/login"} className="btn-primary btn-sm ml-auto md:ml-0">
          {me ? "В систему" : "Открыть систему"} <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>
    </header>
  );
}

/* ---------- 1. Первый экран ---------- */

const ORBIT = ["Паспорт", "Темы", "Источники", "Проверка", "Версии", "MAX"];

function HeroVisual() {
  return (
    <div className="hero-orbit relative mx-auto aspect-square w-full max-w-[420px]" aria-hidden="true">
      <div className="absolute inset-[18%] rounded-full bg-accent/20 blur-3xl" />
      <svg viewBox="0 0 400 400" className="absolute inset-0 h-full w-full">
        <circle cx="200" cy="200" r="190" fill="none" stroke="rgb(var(--line-strong))" strokeDasharray="2 7" />
        <circle cx="200" cy="200" r="140" fill="none" stroke="rgb(var(--line))" />
        <circle cx="200" cy="200" r="90" fill="none" stroke="rgb(var(--line-strong) / 0.7)" strokeDasharray="1 5" />
        <g className="orbit-spin">
          <path d="M200 10 A190 190 0 0 1 390 200" fill="none" stroke="rgb(var(--accent))" strokeWidth="2" strokeLinecap="round" opacity="0.9" />
        </g>
        <g className="orbit-spin-rev">
          <path d="M60 200 A140 140 0 0 1 200 60" fill="none" stroke="rgb(var(--fg-soft))" strokeWidth="1.5" strokeLinecap="round" opacity="0.5" />
        </g>
      </svg>
      <div className="orbit-labels absolute inset-0">
        {ORBIT.map((label, i) => {
          const a = (i / ORBIT.length) * Math.PI * 2 - Math.PI / 2;
          const style = {
            "--ox": Math.cos(a).toFixed(4),
            "--oy": Math.sin(a).toFixed(4),
            animationDelay: `${600 + i * 140}ms`,
          } as CSSProperties;
          return (
            <span key={label} className="orbit-label" style={style}>
              <span className="orbit-label__inner">{label}</span>
            </span>
          );
        })}
      </div>
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="hero-core">
          <LogoMark size={96} />
        </div>
      </div>
    </div>
  );
}

function Hero() {
  return (
    <section id="top" className="shell relative grid items-center gap-12 pb-20 pt-10 sm:pt-16 lg:grid-cols-[1.15fr_1fr] lg:pb-28">
      <div>
        <div className="hero-in label-mono text-accent" style={{ animationDelay: "60ms" }}>
          Внутренняя аналитическая платформа
        </div>
        <h1
          className="hero-in mt-4 text-balance text-[38px] font-extrabold leading-[1.06] tracking-tight text-fg sm:text-6xl"
          style={{ animationDelay: "140ms" }}
        >
          Обращения граждан —{" "}
          <span className="text-glow bg-gradient-to-r from-fg via-fg-soft to-accent bg-clip-text text-transparent">
            разобраны, проверены, готовы к ответу
          </span>
        </h1>
        <p className="hero-in mt-6 max-w-xl text-pretty text-lg leading-relaxed text-muted" style={{ animationDelay: "240ms" }}>
          «Личности» собирают в одном месте факты, темы и источники, помогают увидеть вопросы разных аудиторий и
          готовят прозрачный информационный ответ. ИИ работает как помощник, решение всегда за редактором.
        </p>
        <div className="hero-in mt-8 flex flex-wrap gap-3" style={{ animationDelay: "340ms" }}>
          <Link to="/login" className="btn-primary h-11 px-5 text-[15px]">
            Посмотреть систему <ArrowRight className="h-4 w-4" />
          </Link>
          <a href="#scenario" className="btn-secondary h-11 px-5 text-[15px]">
            Как это работает
          </a>
        </div>
        <dl className="hero-in mt-12 grid max-w-lg grid-cols-3 gap-4 border-t border-line pt-6" style={{ animationDelay: "440ms" }}>
          {[
            { n: 9, t: "разделов паспорта персоны" },
            { n: 6, t: "групп проверки перед запуском" },
            { n: 8, t: "ИИ-навыков в одной системе" },
          ].map((s) => (
            <div key={s.t}>
              <dt className="sr-only">{s.t}</dt>
              <dd className="font-mono text-3xl font-semibold text-fg sm:text-4xl">
                <CountUp to={s.n} />
              </dd>
              <dd className="mt-1 text-xs leading-snug text-muted sm:text-sm">{s.t}</dd>
            </div>
          ))}
        </dl>
      </div>
      <div className="hero-in" style={{ animationDelay: "200ms" }}>
        <HeroVisual />
      </div>
    </section>
  );
}

/* ---------- 2. Проблема ---------- */

const PAINS = [
  {
    icon: FileStack,
    title: "Знания рассыпаны",
    text: "Факты, справки и прошлые ответы лежат в чатах, файлах и у отдельных сотрудников. Каждый новый инфоповод разбирают с нуля.",
  },
  {
    icon: Clock3,
    title: "Факты устаревают",
    text: "Сроки и условия меняются, а в ответ уходит вчерашняя информация. Неясно, что подтверждено, а что — слух.",
  },
  {
    icon: CircleHelp,
    title: "Вопросы упускаются",
    text: "Одна точка зрения не видит, что спросят пенсионер, предприниматель или родитель. Ответ не закрывает главные вопросы людей.",
  },
];

function Problem() {
  return (
    <section className="shell py-20 sm:py-28">
      <SectionHead
        kicker="Задача"
        title="Сотрудникам нужно быстро понять, о чём речь и что ответить"
        lead="Публикации, жалобы и комментарии идут потоком. Ручная работа не даёт ни скорости, ни единой памяти, ни уверенности в фактах."
      />
      <div className="grid gap-4 md:grid-cols-3">
        {PAINS.map((p, i) => (
          <Reveal key={p.title} delay={i * 110} className="panel group relative overflow-hidden p-6 transition-colors hover:border-accent/40">
            <div className="absolute -right-10 -top-10 h-32 w-32 rounded-full bg-accent/0 blur-2xl transition-colors duration-500 group-hover:bg-accent/20" />
            <p.icon className="h-6 w-6 text-accent" />
            <h3 className="mt-4 text-lg font-semibold text-fg">{p.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted">{p.text}</p>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

/* ---------- 3. Решение: из чего состоит ---------- */

const PILLARS: { icon: typeof Layers; title: string; text: string; stage: Stage }[] = [
  {
    icon: UserRoundCog,
    title: "Аналитические персоны",
    text: "Вымышленные модели разных групп аудитории. Помогают заранее увидеть вероятные вопросы и разницу восприятия.",
    stage: "done",
  },
  {
    icon: BookOpenCheck,
    title: "Контекстный центр",
    text: "Темы, документы и утверждения с источником, датой и статусом: подтверждено, спорно, устарело.",
    stage: 3,
  },
  {
    icon: Radar,
    title: "Мониторинг",
    text: "Для важных тем система сама следит за изменениями сроков и появлением новых вопросов.",
    stage: 4,
  },
  {
    icon: Sparkles,
    title: "ИИ-навыки",
    text: "Восемь воспроизводимых операций: разбор материала, проверка фактов, анализ обсуждений, черновик ответа, контроль качества.",
    stage: 4,
  },
  {
    icon: MessageSquareText,
    title: "Бот в MAX",
    text: "Сотрудник отправляет материал в мессенджер и получает разбор — без сложной админ-панели.",
    stage: 5,
  },
  {
    icon: Layers,
    title: "Единый сервер",
    text: "Одна база и одни правила для сайта и бота. Права, журнал действий и версии — на сервере, а не в интерфейсе.",
    stage: "done",
  },
];

function Solution() {
  return (
    <section id="value" className="shell scroll-mt-24 py-20 sm:py-28">
      <SectionHead
        kicker="Решение"
        title={
          <>
            Одно рабочее пространство <span className="text-accent">вместо разрозненных инструментов</span>
          </>
        }
        lead="Веб-студия для редакторов — место настройки и согласования. MAX — рабочий инструмент сотрудника. Сервер — единственный источник истины."
      />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {PILLARS.map((p, i) => (
          <Reveal key={p.title} delay={(i % 3) * 100} className="panel-elevated relative flex flex-col p-6">
            <div className="flex items-start justify-between gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-ui border border-accent/30 bg-accent/10 text-accent shadow-[0_0_24px_-6px_rgb(var(--accent)/0.7)]">
                <p.icon className="h-5 w-5" />
              </span>
              <StageBadge stage={p.stage} />
            </div>
            <h3 className="mt-5 text-lg font-semibold text-fg">{p.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted">{p.text}</p>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

/* ---------- 4. Сценарий в MAX ---------- */

function ChatDemo() {
  const { ref, shown } = useInView<HTMLDivElement>(0.3);
  return (
    <div ref={ref} className="chat panel-elevated mx-auto w-full max-w-md overflow-hidden" data-shown={shown}>
      <div className="flex items-center gap-3 border-b border-line px-4 py-3">
        <LogoMark size={30} />
        <div>
          <div className="text-sm font-semibold text-fg">Личности · бот</div>
          <div className="text-[11px] text-muted">пример сценария, макет</div>
        </div>
      </div>
      <div className="space-y-3 p-4 text-[13.5px] leading-relaxed">
        <div className="msg msg--me" style={{ "--d": "200ms" } as CSSProperties}>
          «Когда наконец доделают дорогу на Садовой? Обещали к 25-му, а там до сих пор техника стоит»
        </div>
        <div className="msg msg--bot" style={{ "--d": "1100ms" } as CSSProperties}>
          Похоже на тему <b className="text-fg">«Ремонт ул. Садовой»</b>. Использовать её?
          <div className="mt-2 flex gap-2">
            <span className="chip border-accent/50 bg-accent/15 text-fg">Да, эта тема</span>
            <span className="chip text-muted">Другая</span>
          </div>
        </div>
        <div className="msg msg--bot" style={{ "--d": "2200ms" } as CSSProperties}>
          <div className="label-mono mb-1.5 text-accent">Разбор</div>
          <ul className="space-y-1.5">
            <li className="flex gap-2">
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-success" />
              <span>
                Срок перенесён на 30 ноября — <u className="decoration-line-strong underline-offset-2">источник, 18 ноя</u>
              </span>
            </li>
            <li className="flex gap-2">
              <Clock3 className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
              <span>«До 25 ноября» — устарело, в ответ не использовать</span>
            </li>
            <li className="flex gap-2">
              <CircleHelp className="mt-0.5 h-4 w-4 shrink-0 text-info" />
              <span className="text-muted">Возможные вопросы: объезд, вывоз техники, компенсация</span>
            </li>
          </ul>
        </div>
        <div className="msg msg--bot" style={{ "--d": "3300ms" } as CSSProperties}>
          <div className="label-mono mb-1.5 text-accent">Черновик ответа</div>
          Работы завершатся до 30 ноября: срок скорректирован подрядчиком… <span className="text-muted">— от имени ведомства, с источником</span>
        </div>
      </div>
    </div>
  );
}

const STEPS = [
  { t: "Материал", d: "Сотрудник пересылает комментарий, ссылку, скриншот или сразу пакет обращений." },
  { t: "Контекст", d: "Система предлагает подходящую тему или черновик новой — сотрудник подтверждает." },
  { t: "Проверка", d: "Утверждения сверяются с базой: что подтверждено, что спорно, что устарело." },
  { t: "Результат", d: "Суть, вопросы людей, факты с источниками и черновик прозрачного ответа." },
];

function Scenario() {
  const { ref, shown } = useInView<HTMLOListElement>(0.25);
  return (
    <section id="scenario" className="relative scroll-mt-24 border-y border-line/70 bg-surface/40 py-20 sm:py-28">
      <div className="shell">
        <SectionHead
          kicker="Ежедневный сценарий"
          title="От комментария до готового ответа — в одном чате"
          lead="Два режима: один материал или пакетный анализ десятков комментариев с группировкой повторяющихся вопросов."
        />
        <div className="grid items-center gap-12 lg:grid-cols-2">
          <ol ref={ref} className="steps relative space-y-7" data-shown={shown}>
            <span className="steps__line" aria-hidden />
            {STEPS.map((s, i) => (
              <li key={s.t} className="steps__item relative pl-14" style={{ "--i": i } as CSSProperties}>
                <span className="absolute left-0 top-0 flex h-10 w-10 items-center justify-center rounded-full border border-accent/50 bg-canvas font-mono text-sm font-semibold text-accent shadow-[0_0_20px_-4px_rgb(var(--accent)/0.8)]">
                  {i + 1}
                </span>
                <h3 className="text-base font-semibold text-fg">{s.t}</h3>
                <p className="mt-1 text-sm leading-relaxed text-muted">{s.d}</p>
              </li>
            ))}
            <li className="steps__item pl-14" style={{ "--i": 4 } as CSSProperties}>
              <StageBadge stage={5} />
              <span className="ml-2 text-xs text-muted">MAX-бот появится на пятом этапе; ядро для него строится сейчас</span>
            </li>
          </ol>
          <ChatDemo />
        </div>
      </div>
    </section>
  );
}

/* ---------- 5. Персоны ---------- */

const FIELDS = [
  { k: "Возраст", v: "около 52 лет", src: "легенда", cert: "приблизительно", tone: "info" },
  { k: "Род занятий", v: "неизвестно", src: "—", cert: "неизвестно", tone: "muted" },
  { k: "Главный вопрос", v: "«Когда и кто за это отвечает?»", src: "редактор", cert: "подтверждено", tone: "success" },
] as const;

function Personas() {
  return (
    <section className="shell py-20 sm:py-28">
      <div className="grid items-center gap-12 lg:grid-cols-2">
        <div>
          <Reveal>
            <div className="label-mono text-accent">Аналитические персоны</div>
            <h2 className="mt-3 text-balance text-[28px] font-bold leading-tight tracking-tight text-fg sm:text-4xl">
              Взгляд разных аудиторий — до того, как ответ ушёл
            </h2>
            <p className="mt-4 text-pretty text-base leading-relaxed text-muted sm:text-lg">
              Персона — вымышленная внутренняя модель с подробным паспортом из девяти разделов: биография, окружение,
              характер, компетенции, речь, поведение. Она подсказывает, какие вопросы может вызвать материал у разных
              групп людей.
            </p>
          </Reveal>
          <Reveal delay={120} className="mt-6 grid gap-3 sm:grid-cols-2">
            <div className="rounded-ui border border-success/30 bg-success/5 p-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-success">
                <Check className="h-4 w-4" /> Это
              </div>
              <p className="mt-1.5 text-sm text-fg-soft">инструмент внутреннего анализа и поиска вопросов</p>
            </div>
            <div className="rounded-ui border border-line-strong bg-elevated/40 p-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-fg-soft">
                <X className="h-4 w-4 text-muted" /> Не это
              </div>
              <p className="mt-1.5 text-sm text-muted">не реальные люди, не аккаунты в соцсетях, не замена опросов и фактов</p>
            </div>
          </Reveal>
        </div>
        <Reveal delay={150}>
          <div className="panel-elevated p-5 sm:p-6">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-accent/15 font-semibold text-accent">П</span>
                <div>
                  <div className="text-sm font-semibold text-fg">Пример паспорта</div>
                  <div className="text-xs text-muted">черновик v1.1 · активна v1.0</div>
                </div>
              </div>
              <StageBadge stage="done" />
            </div>
            <div className="mt-5 space-y-2.5">
              {FIELDS.map((f, i) => (
                <div
                  key={f.k}
                  className="field-row rounded-ui border border-line bg-canvas/50 p-3"
                  style={{ animationDelay: `${i * 160}ms` }}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs text-muted">{f.k}</span>
                    <span className="flex gap-1.5">
                      <span className="chip text-[10.5px] text-muted">источник: {f.src}</span>
                      <span
                        className={clsx(
                          "chip text-[10.5px]",
                          f.tone === "success" && "border-success/40 text-success",
                          f.tone === "info" && "border-info/40 text-info",
                          f.tone === "muted" && "text-muted",
                        )}
                      >
                        {f.cert}
                      </span>
                    </span>
                  </div>
                  <div className={clsx("mt-1 text-sm", f.tone === "muted" ? "italic text-muted" : "text-fg")}>{f.v}</div>
                </div>
              ))}
            </div>
            <p className="mt-4 text-xs leading-relaxed text-muted">
              У каждого поля видно, откуда оно взялось и насколько надёжно. «Неизвестно» — честный ответ, а не пробел,
              который ИИ заполнит выдумкой.
            </p>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

/* ---------- 6. Контроль: ИИ предлагает, человек решает ---------- */

function DiffDemo() {
  return (
    <div className="panel-elevated p-5 sm:p-6">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold text-fg">
          <Sparkles className="h-4 w-4 text-accent" /> Предложение ИИ
        </div>
        <StageBadge stage={2} />
      </div>
      <div className="mt-4 space-y-2 font-mono text-[12.5px]">
        <div className="diff-old rounded-ui border border-danger/25 bg-danger/5 px-3 py-2 text-danger/90">
          − Профессия: автомеханик
        </div>
        <div className="diff-new rounded-ui border border-success/30 bg-success/5 px-3 py-2 text-success">
          + Профессия: неизвестно · гараж — хобби
        </div>
      </div>
      <p className="mt-3 text-xs leading-relaxed text-muted">
        Причина: противоречие с разделом «Жизненный опыт», где редактор указал, что гараж — увлечение.
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <span className="diff-accept btn-primary btn-sm">Принять</span>
        <span className="btn-secondary btn-sm">Изменить</span>
        <span className="btn-ghost btn-sm">Отклонить</span>
      </div>
    </div>
  );
}

const LAB = [
  { t: "Биография", d: "события не противоречат друг другу", s: "pass" },
  { t: "Характер", d: "черты устойчивы в разных ситуациях", s: "pass" },
  { t: "Компетенции", d: "нет придуманной экспертизы", s: "warning" },
  { t: "Восприятие", d: "вопросы согласованы с моделью", s: "pass" },
  { t: "Речь", d: "стиль стабилен, текст не копируется", s: "pass" },
  { t: "Неопределённость", d: "говорит «неизвестно», а не выдумывает", s: "pass" },
] as const;

function LabDemo() {
  const { ref, shown } = useInView<HTMLDivElement>(0.3);
  return (
    <div ref={ref} className="lab panel-elevated p-5 sm:p-6" data-shown={shown}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold text-fg">
          <FlaskConical className="h-4 w-4 text-accent" /> Лаборатория перед запуском
        </div>
        <StageBadge stage={2} />
      </div>
      <ul className="mt-4 divide-y divide-line">
        {LAB.map((r, i) => (
          <li key={r.t} className="flex items-center justify-between gap-3 py-2.5" style={{ "--i": i } as CSSProperties}>
            <div className="min-w-0">
              <div className="text-sm font-medium text-fg">{r.t}</div>
              <div className="truncate text-xs text-muted">{r.d}</div>
            </div>
            <span
              className={clsx(
                "lab__status chip shrink-0 font-mono text-[10.5px] uppercase",
                r.s === "pass" ? "border-success/40 text-success" : "border-warning/50 text-warning",
              )}
            >
              <span className={clsx("h-1.5 w-1.5 rounded-full", r.s === "pass" ? "bg-success" : "bg-warning")} />
              {r.s}
            </span>
          </li>
        ))}
      </ul>
      <div className="mt-4 rounded-ui border border-line bg-canvas/50 p-3 text-xs leading-relaxed text-muted">
        <b className="text-fg-soft">Warning</b> — рекомендация, не мешает запуску. <b className="text-danger">Critical</b> — запуск
        блокируется на сервере, обойти из интерфейса нельзя. Никаких «готовность 93%» без объяснений.
      </div>
    </div>
  );
}

function Control() {
  return (
    <section id="control" className="relative scroll-mt-24 border-y border-line/70 bg-surface/40 py-20 sm:py-28">
      <div className="shell">
        <SectionHead
          kicker="Контроль качества"
          title={
            <>
              ИИ предлагает. <span className="text-accent">Решает человек.</span>
            </>
          }
          lead="ИИ не может молча изменить паспорт, тему или факт. Каждое предложение видно как правка с причиной — редактор принимает, исправляет или отклоняет."
        />
        <div className="grid gap-6 lg:grid-cols-2">
          <Reveal>
            <DiffDemo />
          </Reveal>
          <Reveal delay={140}>
            <LabDemo />
          </Reveal>
        </div>
      </div>
    </section>
  );
}

/* ---------- 7. Доверие ---------- */

const TRUST: { icon: typeof Lock; title: string; text: string; stage: Stage }[] = [
  {
    icon: GitBranch,
    title: "Версии без сюрпризов",
    text: "Работающая версия заморожена — пока редактор готовит v1.1, все пользуются проверенной v1.0. Каждое задание помнит, на какой версии знаний выполнено.",
    stage: "done",
  },
  {
    icon: History,
    title: "Полный журнал",
    text: "Кто, когда и что изменил — фиксируется автоматически, включая отклонённые попытки запуска.",
    stage: "done",
  },
  {
    icon: ShieldCheck,
    title: "Права по ролям",
    text: "Редактор, автор, оператор, администратор. Правила проверяет сервер, а не кнопки в интерфейсе.",
    stage: "done",
  },
  {
    icon: Eye,
    title: "Честный статус",
    text: "Если ИИ или поиск не подключены, система так и пишет. Никаких выдуманных результатов «для красоты».",
    stage: "done",
  },
  {
    icon: BookOpenCheck,
    title: "Факты со сроком годности",
    text: "У каждого утверждения — источник, дата и статус. Устаревшее не попадёт в ответ как действующее.",
    stage: 3,
  },
  {
    icon: Lock,
    title: "Прозрачное авторство",
    text: "Ответы публикуются только от имени ведомства. Персоны не пишут посты и не изображают жителей.",
    stage: "done",
  },
];

function Trust() {
  return (
    <section className="shell py-20 sm:py-28">
      <SectionHead
        kicker="Надёжность"
        title="Система, которой можно доверять ответ"
        lead="Защита заложена в фундамент: в базу данных и серверные правила, а не только в интерфейс."
      />
      <div className="grid gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
        {TRUST.map((t, i) => (
          <Reveal key={t.title} delay={(i % 3) * 90} className="relative border-l border-line pl-5">
            <span className="absolute -left-px top-0 h-8 w-px bg-accent shadow-[0_0_12px_rgb(var(--accent))]" />
            <div className="flex items-center justify-between gap-3">
              <t.icon className="h-5 w-5 text-accent" />
              <StageBadge stage={t.stage} />
            </div>
            <h3 className="mt-3 text-base font-semibold text-fg">{t.title}</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-muted">{t.text}</p>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

/* ---------- 8. План ---------- */

const ROADMAP: { n: number; t: string; d: string; state: "done" | "next" | "later" }[] = [
  { n: 1, t: "Фундамент", d: "Вход и роли, каталог персон, паспорт из 9 разделов, версии, журнал, дизайн-система", state: "done" },
  { n: 2, t: "Студия персон", d: "ИИ-интервью, предложения с правками, проверка целостности, лаборатория, запуск версий", state: "next" },
  { n: 3, t: "Контекстный центр", d: "Темы, документы, реестр источников, факты со статусами и сроками", state: "later" },
  { n: 4, t: "Мониторинг и навыки", d: "Слежение за важными темами, очередь редактора, восемь ИИ-навыков", state: "later" },
  { n: 5, t: "Задания и MAX", d: "Бот для сотрудников, разовый и пакетный анализ, пилот", state: "later" },
];

function Roadmap() {
  return (
    <section id="roadmap" className="relative scroll-mt-24 border-y border-line/70 bg-surface/40 py-20 sm:py-28">
      <div className="shell">
        <SectionHead
          kicker="План"
          title="Пять этапов до пилота"
          lead="Каждый этап — работающая часть системы с базой, правами и тестами, а не макеты экранов."
        />
        <ol className="grid gap-4 md:grid-cols-5">
          {ROADMAP.map((r, i) => (
            <Reveal
              as="li"
              key={r.n}
              delay={i * 100}
              className={clsx(
                "relative rounded-card border p-5",
                r.state === "done" && "border-success/40 bg-success/[0.06]",
                r.state === "next" && "roadmap-next border-accent/60 bg-accent/[0.07]",
                r.state === "later" && "border-line bg-surface/70",
              )}
            >
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs text-muted">ЭТАП {r.n}</span>
                {r.state === "done" && <Check className="h-4 w-4 text-success" />}
                {r.state === "next" && <span className="h-2 w-2 animate-pulse rounded-full bg-accent" />}
              </div>
              <h3 className="mt-3 font-semibold text-fg">{r.t}</h3>
              <p className="mt-1.5 text-[13px] leading-relaxed text-muted">{r.d}</p>
              <div
                className={clsx(
                  "mt-4 font-mono text-[10.5px] uppercase tracking-[0.08em]",
                  r.state === "done" ? "text-success" : r.state === "next" ? "text-accent" : "text-muted",
                )}
              >
                {r.state === "done" ? "готово" : r.state === "next" ? "в работе" : "запланировано"}
              </div>
            </Reveal>
          ))}
        </ol>

        <Reveal className="mt-12 panel p-6 sm:p-8">
          <h3 className="text-lg font-semibold text-fg">Что нужно для запуска</h3>
          <div className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { t: "Сервер", d: "Для общей рабочей версии команды. Демо уже доступно в браузере." },
              { t: "Языковая модель", d: "Доступ к ИИ-провайдеру, работающему из российской инфраструктуры." },
              { t: "Бот в MAX", d: "Регистрация бота и токен — к пятому этапу." },
              { t: "Решения", d: "Несколько вопросов о правах и согласованиях — список готов." },
            ].map((x, i) => (
              <div key={x.t} className="flex gap-3">
                <span className="font-mono text-sm text-accent">0{i + 1}</span>
                <div>
                  <div className="text-sm font-semibold text-fg">{x.t}</div>
                  <p className="mt-1 text-sm leading-relaxed text-muted">{x.d}</p>
                </div>
              </div>
            ))}
          </div>
        </Reveal>
      </div>
    </section>
  );
}

/* ---------- 9. Финал ---------- */

function FinalCta() {
  return (
    <section className="shell py-24 sm:py-32">
      <Reveal className="hero-glow relative overflow-hidden rounded-card border border-accent/30 px-6 py-14 text-center sm:px-12">
        <div className="mx-auto flex justify-center">
          <LogoMark size={56} />
        </div>
        <h2 className="mx-auto mt-6 max-w-2xl text-balance text-3xl font-bold tracking-tight text-fg sm:text-4xl">
          Быстрее разобраться. Точнее ответить. Всё под контролем.
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-muted">
          Демо-версия открыта: каталог персон, паспорт, версии и барьер запуска можно посмотреть уже сейчас.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link to="/login" className="btn-primary h-11 px-6 text-[15px]">
            Открыть систему <ArrowRight className="h-4 w-4" />
          </Link>
          <a href="#top" className="btn-secondary h-11 px-6 text-[15px]">
            Наверх
          </a>
        </div>
      </Reveal>
      <p className="mt-10 text-center text-xs text-muted">
        «Личности» — внутренняя платформа. Персоны вымышлены и служат только для анализа; публичные ответы — с
        прозрачным авторством.
      </p>
    </section>
  );
}

export function AboutPage() {
  useAmbient("high");
  useEffect(() => {
    const prev = document.title;
    document.title = "Личности — о проекте";
    return () => {
      document.title = prev;
    };
  }, []);
  return (
    <>
      <Ambient />
      <AboutNav />
      <main className="about relative z-10" style={{ paddingTop: "var(--nav-height)" }}>
        <Hero />
        <Problem />
        <Solution />
        <Scenario />
        <Personas />
        <Control />
        <Trust />
        <Roadmap />
        <FinalCta />
      </main>
    </>
  );
}
