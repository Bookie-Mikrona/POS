import { motion } from 'framer-motion';

const ease = [0.16, 1, 0.3, 1] as const;

export function Scene1() {
  return (
    <motion.div 
      className="absolute inset-0 flex flex-col items-center justify-center origin-center"
      initial={{ opacity: 0, clipPath: 'circle(0% at 50% 50%)' }}
      animate={{ opacity: 1, clipPath: 'circle(150% at 50% 50%)' }}
      exit={{ opacity: 0, scale: 1.1, filter: 'blur(20px)' }}
      transition={{ duration: 1.5, ease }}
    >
      <div className="relative w-full h-full flex flex-col items-center justify-center">
        {/* Floating complex UI cards */}
        <motion.div 
          className="absolute w-[20vw] h-[15vw] bg-slate-800/80 border border-slate-700 rounded-xl p-4 shadow-2xl backdrop-blur-md"
          initial={{ y: '20vh', opacity: 0, rotate: -15, scale: 0.8 }}
          animate={{ y: '-10vh', opacity: 0.6, rotate: -5, scale: 1 }}
          transition={{ duration: 2, delay: 0.2, ease }}
          style={{ top: '20%', left: '15%' }}
        >
          <div className="w-full h-4 bg-slate-700 rounded mb-4" />
          <div className="w-3/4 h-3 bg-slate-600 rounded mb-2" />
          <div className="w-1/2 h-3 bg-slate-600 rounded mb-8" />
          <div className="w-full h-[5vw] bg-slate-700/50 rounded" />
        </motion.div>

        <motion.div 
          className="absolute w-[22vw] h-[18vw] bg-slate-800/90 border border-slate-700 rounded-xl p-4 shadow-2xl backdrop-blur-md"
          initial={{ y: '30vh', opacity: 0, rotate: 20, scale: 0.8 }}
          animate={{ y: '5vh', opacity: 0.5, rotate: 8, scale: 1 }}
          transition={{ duration: 2, delay: 0.4, ease }}
          style={{ top: '30%', right: '10%' }}
        >
          <div className="flex justify-between mb-4">
            <div className="w-8 h-8 rounded-full bg-slate-700" />
            <div className="w-16 h-8 rounded bg-red-500/20 text-red-400 text-[0.6vw] flex items-center justify-center border border-red-500/30">DDV ERROR</div>
          </div>
          <div className="w-full h-3 bg-slate-600 rounded mb-2" />
          <div className="w-full h-3 bg-slate-600 rounded mb-2" />
          <div className="w-2/3 h-3 bg-slate-600 rounded" />
        </motion.div>

        <motion.div 
          className="absolute w-[18vw] h-[25vw] bg-white border border-slate-200 rounded-lg p-4 shadow-2xl origin-bottom"
          initial={{ y: '50vh', opacity: 0, rotateX: 45, scale: 0.5 }}
          animate={{ y: '20vh', opacity: 0.8, rotateX: 0, scale: 1 }}
          transition={{ duration: 2.5, delay: 0.6, ease }}
          style={{ top: '10%', left: '40%' }}
        >
          <div className="w-full h-full border-2 border-dashed border-slate-300 flex flex-col items-center p-4">
             <div className="text-slate-900 text-[1.2vw] font-bold font-['Plus_Jakarta_Sans'] mb-4">RAČUN 404</div>
             <div className="w-full border-b border-slate-300 border-dashed mb-4" />
             <div className="flex justify-between w-full mb-2">
               <div className="w-1/2 h-2 bg-slate-200 rounded" />
               <div className="w-1/4 h-2 bg-slate-300 rounded" />
             </div>
             <div className="flex justify-between w-full mb-2">
               <div className="w-1/2 h-2 bg-slate-200 rounded" />
               <div className="w-1/4 h-2 bg-slate-300 rounded" />
             </div>
             <div className="flex justify-between w-full mb-8">
               <div className="w-1/2 h-2 bg-slate-200 rounded" />
               <div className="w-1/4 h-2 bg-slate-300 rounded" />
             </div>
             <div className="w-full border-b border-slate-300 border-dashed mb-4" />
             <div className="flex justify-between w-full text-slate-800 font-bold text-[1vw]">
               <div>SKUPAJ</div>
               <div>€ 24.50</div>
             </div>
          </div>
        </motion.div>

        {/* Text */}
        <div className="relative z-10 flex flex-col items-center justify-center text-center mt-[15vh]">
          <motion.div 
            className="bg-brand-gold text-slate-900 font-bold px-[1vw] py-[0.4vw] rounded-sm text-[1.2vw] tracking-wider uppercase mb-[2vw]"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 1, delay: 1.5, ease }}
          >
            Sistem Bookie
          </motion.div>
          
          <motion.h1 
            className="text-[4vw] font-extrabold font-['Plus_Jakarta_Sans'] leading-[1.1] tracking-tight max-w-[80vw]"
            initial={{ opacity: 0, y: 40, filter: 'blur(10px)' }}
            animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
            transition={{ duration: 1.5, delay: 1.8, ease }}
          >
            Gostinstvo je <span className="text-brand-gold">zahtevno.</span>
          </motion.h1>

          <motion.p 
            className="text-[1.8vw] text-slate-300 mt-[1.5vw] font-medium max-w-[70vw]"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 1.5, delay: 2.8, ease }}
          >
            Vsak račun, vsak bon, vsak DDV mora biti pravilen.
          </motion.p>
        </div>
      </div>
    </motion.div>
  );
}