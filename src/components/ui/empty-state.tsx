import type { ReactNode } from 'react';

export interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description: string;
  action?: {
    label: string;
    href: string;
    onClick?: () => void;
  };
  className?: string;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className = '',
}: EmptyStateProps) {
  return (
    <div
      className={`bg-white rounded-[3rem] p-20 text-center border border-gray-100 shadow-sm ${className}`}
    >
      {icon ? (
        <div className="w-24 h-24 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-8">
          {icon}
        </div>
      ) : null}
      <h2 className="text-3xl font-black text-gray-900 mb-4">{title}</h2>
      <p className="text-gray-500 text-lg mb-10 max-w-md mx-auto">
        {description}
      </p>
      {action && (
        <a
          href={action.href}
          onClick={action.onClick}
          className="inline-flex items-center justify-center gap-2 h-12 px-8 bg-primary-600 text-white font-bold rounded-2xl hover:bg-primary-700 active:scale-[0.98] transition-all shadow-xl shadow-primary-500/20"
        >
          {action.label}
        </a>
      )}
    </div>
  );
}
