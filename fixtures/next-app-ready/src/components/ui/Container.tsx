import type { ReactNode } from "react";

interface ContainerProps {
  children: ReactNode;
  className?: string;
  fullBleed?: boolean;
}

export function Container({ children, className = "", fullBleed = false }: ContainerProps) {
  return (
    <div
      className={`mx-auto w-full max-w-[1440px] px-4 md:px-8 xl:px-[80px] ${
        fullBleed ? "w-screen max-w-none" : ""
      } ${className}`}
    >
      {children}
    </div>
  );
}
