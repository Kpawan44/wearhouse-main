import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Sun, Moon } from 'lucide-react';

interface ThemeToggleProps {
  theme: 'light' | 'dark';
  onToggleTheme: (theme: 'light' | 'dark') => void;
  variant?: 'switch' | 'segmented';
  className?: string;
  showLabels?: boolean;
}

export const ThemeToggle: React.FC<ThemeToggleProps> = ({
  theme,
  onToggleTheme,
  variant = 'segmented',
  className = '',
  showLabels = true,
}) => {
  const isDark = theme === 'dark';

  if (variant === 'switch') {
    return (
      <div className={`flex items-center gap-2 ${className}`}>
        {showLabels && (
          <span className="text-[10px] font-bold tracking-wider text-slate-400 uppercase hidden sm:inline-block">
            {isDark ? 'Dark Mode' : 'Light Mode'}
          </span>
        )}
        <motion.button
          type="button"
          whileHover={{ scale: 1.06 }}
          whileTap={{ scale: 0.92 }}
          onClick={() => onToggleTheme(isDark ? 'light' : 'dark')}
          className={`relative flex items-center w-14 h-7 p-1 rounded-full cursor-pointer transition-colors border shadow-inner overflow-hidden ${
            isDark
              ? 'bg-slate-900 border-indigo-500/40'
              : 'bg-indigo-100/90 border-indigo-200'
          }`}
          aria-label={`Switch to ${isDark ? 'light' : 'dark'} mode`}
          title={`Toggle Theme (Current: ${isDark ? 'Dark Mode' : 'Light Mode'})`}
        >
          {/* Subtle glow backdrop animation */}
          <motion.div
            animate={{
              opacity: isDark ? [0.4, 0.7, 0.4] : [0.3, 0.6, 0.3],
            }}
            transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
            className={`absolute inset-0 rounded-full blur-xs ${
              isDark ? 'bg-indigo-600/30' : 'bg-amber-400/40'
            }`}
          />

          {/* Background icon hints */}
          <div className="absolute inset-0 flex items-center justify-between px-2 text-[10px] pointer-events-none select-none">
            <motion.div
              animate={{ scale: isDark ? 0.7 : 0, opacity: isDark ? 0.4 : 0 }}
              transition={{ duration: 0.2 }}
            >
              <Sun className="w-3 h-3 text-amber-500" />
            </motion.div>
            <motion.div
              animate={{ scale: isDark ? 0 : 0.7, opacity: isDark ? 0 : 0.4 }}
              transition={{ duration: 0.2 }}
            >
              <Moon className="w-3 h-3 text-indigo-400" />
            </motion.div>
          </div>

          {/* Sliding Knob */}
          <motion.div
            layout
            transition={{
              type: 'spring',
              stiffness: 500,
              damping: 30,
            }}
            animate={{
              x: isDark ? 28 : 0,
            }}
            className={`w-5 h-5 rounded-full flex items-center justify-center shadow-md z-10 ${
              isDark
                ? 'bg-slate-950 text-indigo-300 border border-indigo-500/50 shadow-indigo-950/50'
                : 'bg-amber-400 text-slate-900 border border-amber-300 shadow-amber-500/30'
            }`}
          >
            <AnimatePresence mode="wait" initial={false}>
              {isDark ? (
                <motion.div
                  key="moon-knob"
                  initial={{ rotate: -90, opacity: 0, scale: 0.4 }}
                  animate={{ rotate: 0, opacity: 1, scale: 1 }}
                  exit={{ rotate: 90, opacity: 0, scale: 0.4 }}
                  transition={{ duration: 0.2, ease: 'easeOut' }}
                >
                  <Moon className="w-3 h-3 text-indigo-300 fill-indigo-300/30" />
                </motion.div>
              ) : (
                <motion.div
                  key="sun-knob"
                  initial={{ rotate: 90, opacity: 0, scale: 0.4 }}
                  animate={{ rotate: 0, opacity: 1, scale: 1 }}
                  exit={{ rotate: -90, opacity: 0, scale: 0.4 }}
                  transition={{ duration: 0.2, ease: 'easeOut' }}
                >
                  <Sun className="w-3 h-3 text-slate-900 fill-amber-300" />
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        </motion.button>
      </div>
    );
  }

  return (
    <div className={`relative grid grid-cols-2 gap-1.5 p-1 bg-slate-100 dark:bg-slate-900/80 rounded-xl border border-slate-200 dark:border-slate-800 ${className}`}>
      <button
        type="button"
        onClick={() => onToggleTheme('light')}
        className={`relative z-10 flex items-center justify-center gap-2 py-2.5 px-3 rounded-lg text-xs font-bold transition-all cursor-pointer ${
          !isDark
            ? 'text-indigo-700 dark:text-indigo-300 font-extrabold'
            : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
        }`}
      >
        {!isDark && (
          <motion.div
            layoutId="activeThemePill"
            transition={{ type: 'spring', stiffness: 500, damping: 35 }}
            className="absolute inset-0 bg-white dark:bg-slate-800 rounded-lg shadow-sm border border-slate-200/80 dark:border-slate-700 -z-10"
          />
        )}
        <motion.div
          animate={{
            rotate: !isDark ? [0, 20, -10, 0] : 0,
            scale: !isDark ? [1, 1.15, 1] : 1,
          }}
          transition={{ duration: 0.4 }}
        >
          <Sun className={`w-4 h-4 ${!isDark ? 'text-amber-500 fill-amber-400/30' : 'text-slate-400'}`} />
        </motion.div>
        <span>Light Mode</span>
      </button>

      <button
        type="button"
        onClick={() => onToggleTheme('dark')}
        className={`relative z-10 flex items-center justify-center gap-2 py-2.5 px-3 rounded-lg text-xs font-bold transition-all cursor-pointer ${
          isDark
            ? 'text-indigo-400 font-extrabold'
            : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
        }`}
      >
        {isDark && (
          <motion.div
            layoutId="activeThemePill"
            transition={{ type: 'spring', stiffness: 500, damping: 35 }}
            className="absolute inset-0 bg-slate-800 border border-indigo-500/40 rounded-lg shadow-sm -z-10"
          />
        )}
        <motion.div
          animate={{
            rotate: isDark ? [0, -20, 10, 0] : 0,
            scale: isDark ? [1, 1.15, 1] : 1,
          }}
          transition={{ duration: 0.4 }}
        >
          <Moon className={`w-4 h-4 ${isDark ? 'text-indigo-400 fill-indigo-400/30' : 'text-slate-400'}`} />
        </motion.div>
        <span>Dark Mode</span>
      </button>
    </div>
  );
};
