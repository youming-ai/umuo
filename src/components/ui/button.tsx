import * as React from 'react';
import { cn } from '../../lib/utils';

interface ButtonVariants {
  variant?:
  | 'default'
  | 'destructive'
  | 'outline'
  | 'secondary'
  | 'ghost'
  | 'link';
  size?: 'default' | 'sm' | 'lg' | 'xl' | 'icon';
}

const buttonVariants = ({
  variant = 'default',
  size = 'default',
  className = '',
}: ButtonVariants & { className?: string }) => {
  const base =
    'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg border font-medium text-sm outline-none transition-all focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg]:size-4';

  const variants = {
    default:
      'border-transparent bg-primary text-primary-foreground shadow hover:bg-primary/90 active:scale-[0.98]',
    destructive:
      'border-transparent bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90 active:scale-[0.98]',
    outline:
      'border-input bg-background text-foreground shadow-sm hover:bg-accent hover:text-accent-foreground active:scale-[0.98]',
    secondary:
      'border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80 active:scale-[0.98]',
    ghost:
      'border-transparent text-foreground hover:bg-accent hover:text-accent-foreground',
    link: 'border-transparent text-primary underline-offset-4 hover:underline',
  };

  const sizes = {
    default: 'h-9 px-4',
    sm: 'h-8 px-3 text-xs',
    lg: 'h-10 px-6',
    xl: 'h-11 px-8 text-base',
    icon: 'size-9',
  };

  return cn(base, variants[variant], sizes[size], className);
};

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
  ButtonVariants {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    // If asChild is true and we have a single child element, render as that child
    if (asChild && React.Children.count(props.children) === 1) {
      const child = React.Children.only(
        props.children,
      ) as React.ReactElement & {
        ref?: React.Ref<unknown>;
      };
      return React.cloneElement(child, {
        ...props,
        className: cn(
          buttonVariants({ variant, size, className }),
          child.props.className,
        ),
        ref: (node: unknown) => {
          // Handle both function and object refs
          if (typeof ref === 'function') {
            ref(node as HTMLButtonElement);
          } else if (ref) {
            (ref as React.MutableRefObject<unknown>).current = node;
          }
          // Also handle the child's original ref
          if (typeof child.ref === 'function') {
            child.ref(node);
          } else if (child.ref) {
            (child.ref as React.MutableRefObject<unknown>).current = node;
          }
        },
      });
    }

    return (
      <button
        ref={ref}
        className={buttonVariants({ variant, size, className })}
        {...props}
      />
    );
  },
);

Button.displayName = 'Button';

export { Button, buttonVariants };
