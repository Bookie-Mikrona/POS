import { motion } from 'framer-motion';

const ease = [0.16, 1, 0.3, 1] as const;

export function Scene3() {
  // Staggered receipts
  const receipts = [0, 1, 2, 3, 4];
  
  return (
    <motion.div 
      className="absolute inset-0 flex flex-col items-center justify-center origin-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, scale: 1.05, filter: 'blur(10px)' }}
      transition={{ duration: 1.2, ease }}
    >
      <div className="relative z-10 w-full h-full flex items-center justify-center p-[5vw]">
        
        {/* Left side: Flying receipts */}
        <div className="flex-1 h-full relative flex items-center justify-center">
          {receipts.map((i) => (
            <motion.div
              key={`receipt-${i}`}
              className="absolute w-[12vw] h-[15vw] bg-white text-slate-800 p-[1vw] shadow-xl rounded border border-slate-200"
              initial={{ 
                opacity: 0, 
                x: '-30vw', 
                y: (i - 2) * 50, 
                rotate: -20 + i * 5, 
                scale: 0.5 
              }}
              animate={{ 
                opacity: [0, 1, 1, 0], 
                x: ['-30vw', '-10vw', '10vw', '30vw'], 
                scale: [0.5, 1, 0.8, 0],
                rotate: [-20 + i * 5, 0, 10, 20]
              }}
              transition={{ 
                duration: 4, 
                delay: 0.5 + i * 0.4, 
                ease: "easeInOut",
                times: [0, 0.2, 0.8, 1]
              }}
            >
              <div className="border-b border-dashed border-slate-300 pb-[0.5vw] mb-[0.5vw]">
                <div className="w-1/2 h-[0.5vw] bg-slate-200 rounded" />
              </div>
              <div className="w-3/4 h-[0.5vw] bg-slate-100 rounded mb-[0.5vw]" />
              <div className="w-full h-[0.5vw] bg-slate-100 rounded mb-[0.5vw]" />
              <div className="w-2/3 h-[0.5vw] bg-slate-100 rounded mb-[1vw]" />
              <div className="flex justify-between font-bold text-[0.8vw]">
                <span>TOTAL</span>
                <span>€ {12 + i * 8}.50</span>
              </div>
            </motion.div>
          ))}
        </div>

        {/* Right side: Journal forming */}
        <div className="flex-1 flex flex-col justify-center items-start pl-[5vw]">
          <motion.div
            className="bg-brand-blue-light border border-slate-700 p-[3vw] rounded-xl shadow-2xl relative overflow-hidden"
            initial={{ opacity: 0, x: 100 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 1.5, delay: 1, ease }}
          >
            {/* Success flash overlay */}
            <motion.div 
              className="absolute inset-0 bg-brand-green mix-blend-overlay"
              initial={{ opacity: 0 }}
              animate={{ opacity: [0, 0.5, 0] }}
              transition={{ duration: 1, delay: 3, ease }}
            />
            
            <div className="flex items-center gap-[1vw] mb-[2vw]">
              <div className="w-[3vw] h-[3vw] bg-brand-green/20 text-brand-green rounded-lg flex items-center justify-center">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-[1.5vw] h-[1.5vw]">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h3 className="text-[1.8vw] font-bold text-white font-['Plus_Jakarta_Sans']">Dnevna temeljnica</h3>
            </div>

            {/* Journal Lines */}
            <div className="space-y-[1vw]">
              {[0, 1, 2].map((i) => (
                <motion.div 
                  key={`line-${i}`}
                  className="flex gap-[2vw] border-b border-slate-700/50 pb-[1vw]"
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.8, delay: 2.5 + i * 0.3, ease }}
                >
                  <div className="w-[4vw] text-brand-gray font-mono text-[1vw]">
                    {i === 0 ? '1200' : i === 1 ? '7600' : '2600'}
                  </div>
                  <div className="flex-1 flex justify-between gap-[2vw]">
                    <div className="w-1/2 h-[1vw] bg-slate-700 rounded" />
                    <div className="text-right text-[1vw] text-white">
                      {i === 0 ? '€ 142.50' : i === 1 ? '€ 110.00' : '€ 32.50'}
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          </motion.div>

          {/* Text block below */}
          <motion.div 
            className="mt-[4vw]"
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 1.2, delay: 4, ease }}
          >
            <h2 className="text-[3vw] font-extrabold font-['Plus_Jakarta_Sans'] leading-tight">
              POS <span className="text-brand-gray mx-[1vw]">→</span> ERP
            </h2>
            <p className="text-[1.5vw] text-brand-green mt-[1vw]">
              Dnevne temeljnice se knjižijo <span className="font-bold">samodejno.</span>
            </p>
          </motion.div>
        </div>

      </div>
    </motion.div>
  );
}