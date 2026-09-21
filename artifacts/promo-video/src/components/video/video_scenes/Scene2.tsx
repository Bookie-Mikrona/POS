import { motion } from 'framer-motion';

const ease = [0.16, 1, 0.3, 1] as const;

export function Scene2() {
  return (
    <motion.div 
      className="absolute inset-0 flex flex-col items-center justify-center origin-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, scale: 0.9, filter: 'blur(20px)' }}
      transition={{ duration: 1.5, ease }}
    >
      {/* Wipe transition background from left to right */}
      <motion.div 
        className="absolute inset-0 bg-[#0f172a] z-0"
        initial={{ clipPath: 'inset(0 100% 0 0)' }}
        animate={{ clipPath: 'inset(0 0% 0 0)' }}
        transition={{ duration: 1.2, ease }}
      />
      
      <div className="relative z-10 w-full h-full flex flex-col items-center justify-center">
        
        {/* Core Visualization */}
        <div className="flex items-center justify-center w-full max-w-[80vw] mb-[5vw] mt-[5vh]">
          
          {/* POS Box */}
          <motion.div 
            className="flex-1 bg-white/5 border border-white/10 rounded-2xl p-[2vw] relative backdrop-blur-md"
            initial={{ x: -100, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            transition={{ duration: 1.5, delay: 0.5, ease }}
          >
            <div className="absolute -top-[1.5vw] left-[2vw] bg-brand-gold text-slate-900 font-bold px-[1vw] py-[0.2vw] rounded text-[1vw]">
              POS Blagajna
            </div>
            <div className="flex flex-col gap-[1vw] mt-[1vw]">
              <div className="h-[1vw] w-1/2 bg-white/20 rounded" />
              <div className="h-[3vw] w-full bg-white/10 rounded" />
              <div className="h-[3vw] w-full bg-white/10 rounded" />
              <div className="h-[3vw] w-full bg-white/10 rounded" />
            </div>
          </motion.div>

          {/* Connection */}
          <div className="w-[15vw] relative flex items-center justify-center h-[10vw]">
            <motion.div 
              className="absolute h-[0.2vw] w-full bg-white/10"
              initial={{ scaleX: 0 }}
              animate={{ scaleX: 1 }}
              transition={{ duration: 1, delay: 1.5, ease }}
            />
            {/* Glowing particle */}
            <motion.div 
              className="w-[1vw] h-[1vw] rounded-full bg-brand-green shadow-[0_0_20px_#10b981] absolute z-10"
              initial={{ left: '0%', opacity: 0 }}
              animate={{ left: '100%', opacity: [0, 1, 1, 0] }}
              transition={{ 
                duration: 2, 
                delay: 2, 
                ease: "linear",
                repeat: Infinity,
                repeatDelay: 0.5
              }}
            />
            {/* Text indicator */}
            <motion.div
              className="absolute -top-[2vw] text-brand-green font-bold text-[0.9vw] tracking-widest uppercase"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 1, delay: 2, ease }}
            >
              Realni čas
            </motion.div>
          </div>

          {/* ERP Box */}
          <motion.div 
            className="flex-1 bg-white/5 border border-white/10 rounded-2xl p-[2vw] relative backdrop-blur-md"
            initial={{ x: 100, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            transition={{ duration: 1.5, delay: 0.8, ease }}
          >
            <div className="absolute -top-[1.5vw] right-[2vw] bg-brand-green text-slate-900 font-bold px-[1vw] py-[0.2vw] rounded text-[1vw]">
              ERP Računovodstvo
            </div>
            <div className="flex flex-col gap-[1vw] mt-[1vw]">
              <div className="flex justify-between">
                <div className="h-[1.5vw] w-1/3 bg-white/20 rounded" />
                <div className="h-[1.5vw] w-1/4 bg-brand-green/40 rounded" />
              </div>
              <div className="h-[0.2vw] w-full bg-white/10 my-[0.5vw]" />
              <div className="flex justify-between">
                <div className="h-[1vw] w-1/2 bg-white/10 rounded" />
                <div className="h-[1vw] w-1/5 bg-white/20 rounded" />
              </div>
              <div className="flex justify-between">
                <div className="h-[1vw] w-[40%] bg-white/10 rounded" />
                <div className="h-[1vw] w-1/4 bg-white/20 rounded" />
              </div>
            </div>
          </motion.div>

        </div>

        {/* Text */}
        <motion.h2 
          className="text-[3.5vw] font-bold font-['Plus_Jakarta_Sans'] max-w-[75vw] text-center"
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1.2, delay: 2.8, ease }}
        >
          Bookie poveže blagajno z računovodstvom v <span className="text-brand-green">realnem času.</span>
        </motion.h2>

      </div>
    </motion.div>
  );
}