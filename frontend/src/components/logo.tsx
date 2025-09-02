import { useTheme } from '@/components/theme-provider';
import { useEffect, useState } from 'react';

export function Logo({ className = '' }: { className?: string }) {
  const { theme } = useTheme();
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    const updateTheme = () => {
      if (theme === 'LIGHT') {
        setIsDark(false);
      } else if (theme === 'SYSTEM') {
        // System theme
        setIsDark(window.matchMedia('(prefers-color-scheme: dark)').matches);
      } else {
        // All other themes (dark, purple, green, blue, orange, red) have dark backgrounds
        setIsDark(true);
      }
    };

    updateTheme();

    // Listen for system theme changes when using system theme
    if (theme === 'SYSTEM') {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      mediaQuery.addEventListener('change', updateTheme);
      return () => mediaQuery.removeEventListener('change', updateTheme);
    }
  }, [theme]);

  const fillColor = isDark ? '#ffffff' : '#000000';

  return (
<svg
  width="140"
  viewBox="0 0 604 74"
  fill={fillColor}
  xmlns="http://www.w3.org/2000/svg"
  className={className}
>
  <text
    x="0"
    y="56"
    fontFamily="'Inter','Segoe UI',Arial,Helvetica,sans-serif"
    fontSize="56"
    fontWeight="700"
    letterSpacing="2"
  >
    VIBE-KANBAN-TS
  </text>
</svg>
  );
}
