import Link from "next/link";
import type { ReactNode } from "react";

export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-accent">{children}</p>
  );
}

export function Panel({
  children,
  tone = "default",
  className = "",
}: {
  children: ReactNode;
  tone?: "default" | "danger" | "good" | "gold";
  className?: string;
}) {
  const tones = {
    default: "border-line bg-surface",
    danger: "border-danger/30 bg-danger-soft",
    good: "border-good/30 bg-good-soft",
    gold: "border-gold/30 bg-gold-soft",
  };
  return (
    <section className={`rise rounded-2xl border p-5 sm:p-6 ${tones[tone]} ${className}`}>
      {children}
    </section>
  );
}

const BUTTON_BASE =
  "inline-flex items-center justify-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50";
const BUTTON_VARIANTS = {
  primary: "bg-accent text-white hover:bg-accent-strong",
  secondary: "border border-line bg-surface text-ink hover:border-accent/50 hover:bg-accent-soft",
  ghost: "text-muted hover:text-ink",
};

export function Button({
  variant = "primary",
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof BUTTON_VARIANTS }) {
  return (
    <button {...props} className={`${BUTTON_BASE} ${BUTTON_VARIANTS[variant]} ${className}`} />
  );
}

export function LinkButton({
  href,
  variant = "primary",
  className = "",
  onClick,
  children,
}: {
  href: string;
  variant?: keyof typeof BUTTON_VARIANTS;
  className?: string;
  onClick?: () => void;
  children: ReactNode;
}) {
  return (
    <Link href={href} onClick={onClick} className={`${BUTTON_BASE} ${BUTTON_VARIANTS[variant]} ${className}`}>
      {children}
    </Link>
  );
}

export function Badge({
  children,
  tone = "accent",
}: {
  children: ReactNode;
  tone?: "accent" | "danger" | "good" | "gold";
}) {
  const tones = {
    accent: "bg-accent-soft text-accent",
    danger: "bg-danger/10 text-danger",
    good: "bg-good/10 text-good",
    gold: "bg-gold/15 text-[#7d5c14]",
  };
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${tones[tone]}`}>
      {children}
    </span>
  );
}

export function PrincipleBox({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-xl border border-gold/30 bg-gold-soft px-4 py-3.5">
      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#7d5c14]">
        Principle
      </p>
      <p className="mt-1 font-display text-lg font-semibold leading-snug">{title}</p>
      <p className="mt-1 text-sm leading-relaxed text-ink/80">{body}</p>
    </div>
  );
}
