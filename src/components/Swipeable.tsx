import React, { useRef, useState } from 'react';
import { motion, useMotionValue, useTransform } from 'motion/react';
import { Edit3, Trash2, Smartphone } from 'lucide-react';

interface SwipeableProps {
  children: React.ReactNode;
  onSwipeLeft?: () => void;  // Revealed on the right side (typically delete/archive)
  onSwipeRight?: () => void; // Revealed on the left side (typically edit)
  leftBgColor?: string;      // Color shown when swiping right (revealing left)
  leftIcon?: React.ReactNode;
  leftLabel?: string;
  rightBgColor?: string;     // Color shown when swiping left (revealing right)
  rightIcon?: React.ReactNode;
  rightLabel?: string;
  className?: string;
}

export const Swipeable: React.FC<SwipeableProps> = ({
  children,
  onSwipeLeft,
  onSwipeRight,
  leftBgColor = 'bg-indigo-600',
  leftIcon = <Edit3 className="w-4 h-4 text-white" />,
  leftLabel = 'Edit',
  rightBgColor = 'bg-rose-600',
  rightIcon = <Trash2 className="w-4 h-4 text-white" />,
  rightLabel = 'Delete',
  className = '',
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const x = useMotionValue(0);

  // Determine drag direction and threshold compliance
  const [swipeDirection, setSwipeDirection] = useState<'none' | 'left' | 'right'>('none');
  const [triggered, setTriggered] = useState(false);

  // We set drag constraints based on what callbacks are registered
  const canDragLeft = !!onSwipeLeft;
  const canDragRight = !!onSwipeRight;

  const dragConstraints = {
    left: canDragLeft ? -140 : 0,
    right: canDragRight ? 140 : 0,
  };

  // Maps the x displacement to background opacity or other effects if desired
  const leftOpacity = useTransform(x, [0, 80], [0, 1]);
  const rightOpacity = useTransform(x, [-80, 0], [1, 0]);

  const handleDrag = (_: any, info: any) => {
    const offsetX = info.offset.x;
    if (offsetX > 20 && canDragRight) {
      setSwipeDirection('right');
      setTriggered(offsetX > 80);
    } else if (offsetX < -20 && canDragLeft) {
      setSwipeDirection('left');
      setTriggered(offsetX < -80);
    } else {
      setSwipeDirection('none');
      setTriggered(false);
    }
  };

  const handleDragEnd = (_: any, info: any) => {
    const offsetX = info.offset.x;
    
    if (offsetX > 80 && onSwipeRight) {
      onSwipeRight();
    } else if (offsetX < -80 && onSwipeLeft) {
      onSwipeLeft();
    }
    
    // Reset state
    setSwipeDirection('none');
    setTriggered(false);
  };

  return (
    <div
      ref={containerRef}
      className={`relative overflow-hidden rounded-xl select-none touch-pan-y ${className}`}
      style={{ isolation: 'isolate' }}
    >
      {/* Background action layers */}
      <div className="absolute inset-0 w-full h-full flex justify-between items-center -z-10 bg-slate-100 rounded-xl">
        {/* Left Action Background (revealed when dragging right) */}
        <motion.div
          className={`absolute left-0 inset-y-0 w-1/2 flex items-center pl-5 gap-2 rounded-l-xl ${leftBgColor}`}
          style={{ opacity: leftOpacity }}
        >
          <div className={`flex flex-col items-start text-white transition-transform duration-200 ${triggered && swipeDirection === 'right' ? 'scale-110' : 'scale-100'}`}>
            {leftIcon}
            <span className="text-[9px] font-extrabold uppercase tracking-wider mt-1">{leftLabel}</span>
            {triggered && swipeDirection === 'right' && (
              <span className="text-[8px] text-white/80 font-medium block animate-pulse">Release to trigger</span>
            )}
          </div>
        </motion.div>

        {/* Right Action Background (revealed when dragging left) */}
        <motion.div
          className={`absolute right-0 inset-y-0 w-1/2 flex items-center justify-end pr-5 gap-2 rounded-r-xl ${rightBgColor}`}
          style={{ opacity: rightOpacity }}
        >
          <div className={`flex flex-col items-end text-white transition-transform duration-200 ${triggered && swipeDirection === 'left' ? 'scale-110' : 'scale-100'}`}>
            {rightIcon}
            <span className="text-[9px] font-extrabold uppercase tracking-wider mt-1">{rightLabel}</span>
            {triggered && swipeDirection === 'left' && (
              <span className="text-[8px] text-white/80 font-medium block animate-pulse">Release to trigger</span>
            )}
          </div>
        </motion.div>
      </div>

      {/* Foreground Swipeable Card */}
      <motion.div
        drag="x"
        dragDirectionLock
        dragConstraints={dragConstraints}
        dragElastic={0.5}
        dragTransition={{ bounceStiffness: 600, bounceDamping: 25 }}
        style={{ x }}
        onDrag={handleDrag}
        onDragEnd={handleDragEnd}
        className="w-full bg-white h-full relative z-10"
      >
        {children}
      </motion.div>

      {/* Swipe support helper hint icon for mobile devices */}
      <div className="absolute top-1.5 right-1.5 z-20 pointer-events-none md:hidden opacity-40">
        <Smartphone className="w-3.5 h-3.5 text-slate-300 animate-pulse" />
      </div>
    </div>
  );
};
