import { motion } from 'framer-motion';

const ease = [0.16, 1, 0.3, 1] as const;

export function Scene5() {
  return (
    <motion.div 
      className="absolute inset-0 flex flex-col items-center justify-center origin-center"
      initial={{ opacity: 0, clipPath: 'polygon(50% 50%, 50% 50%, 50% 50%, 50% 50%)' }}
      animate={{ opacity: 1, clipPath: 'polygon(0% 0%, 100% 0%, 100% 100%, 0% 100%)' }}
      exit={{ opacity: 0 }}
      transition={{ duration: 1.5, ease }}
    >
      <div className="relative z-10 w-full h-full flex flex-col items-center justify-center text-center">
        
        <div className="flex items-center justify-center gap-[2vw] mb-[4vw]">
          <motion.div 
            className="text-[3vw] font-bold text-brand-gray"
            initial={{ x: -50, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            transition={{ duration: 1.2, delay: 1, ease }}
          >
            Od mize
          </motion.div>
          
          <motion.div 
            className="w-[10vw] h-[0.2vw] bg-slate-700 relative overflow-hidden"
            initial={{ scaleX: 0 }}
            animate={{ scaleX: 1 }}
            transition={{ duration: 1, delay: 1.5, ease }}
          >
            <motion.div 
              className="absolute inset-0 bg-brand-gold"
              initial={{ x: '-100%' }}
              animate={{ x: '100%' }}
              transition={{ duration: 2, delay: 2, ease: "linear", repeat: Infinity }}
            />
          </motion.div>

          <motion.div 
            className="text-[3vw] font-bold text-white"
            initial={{ x: 50, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            transition={{ duration: 1.2, delay: 1.8, ease }}
          >
            Do bilance
          </motion.div>
        </div>

        <motion.h1 
          className="text-[6vw] font-extrabold font-['Plus_Jakarta_Sans'] leading-none text-transparent bg-clip-text bg-gradient-to-r from-white to-slate-400 mb-[4vw]"
          initial={{ opacity: 0, scale: 0.9, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ duration: 1.5, delay: 2.5, ease }}
        >
          Bookie
        </motion.h1>

        <motion.div 
          className="text-[2vw] font-medium text-brand-green tracking-wide"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1.2, delay: 3.5, ease }}
        >
          EN SISTEM. BREZ NAPAK.
        </motion.div>

        {/* Closing particle burst */}
        <motion.div 
          className="absolute inset-0 pointer-events-none"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 1, delay: 3.5 }}
        >
          {[...Array(12)].map((_, i) => (
            <motion.div
              key={i}
              className="absolute top-1/2 left-1/2 w-[0.5vw] h-[0.5vw] bg-brand-gold rounded-full"
              initial={{ x: 0, y: 0, scale: 0, opacity: 1 }}
              animate={{ 
                x: Math.cos(i * 30 * Math.PI / 180) * 40 + 'vw', 
                y: Math.sin(i * 30 * Math.PI / 180) * 40 + 'vw', 
                scale: [0, 1, 0],
                opacity: 0 
              }}
              transition={{ duration: 2, delay: 3.5, ease: "easeOut" }}
            />
          ))}
        </motion.div>

      </div>
    </motion.div>
  );
}