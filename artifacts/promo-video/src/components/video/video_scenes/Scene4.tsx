import { motion } from 'framer-motion';

const ease = [0.16, 1, 0.3, 1] as const;

export function Scene4() {
  const items = [
    { title: 'FURS Fiskalizacija', icon: 'shield' },
    { title: 'e-Računi', icon: 'file' },
    { title: 'DDV Zaključki', icon: 'pie-chart' }
  ];

  return (
    <motion.div 
      className="absolute inset-0 flex flex-col items-center justify-center origin-center"
      initial={{ opacity: 0, y: '20vh' }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: '-20vh' }}
      transition={{ duration: 1.5, ease }}
    >
      <div className="relative z-10 w-full h-full flex flex-col items-center pt-[15vh]">
        
        <motion.div
          className="bg-white/10 px-[1.5vw] py-[0.5vw] rounded-full text-brand-gold text-[1.2vw] font-bold uppercase tracking-widest mb-[2vw]"
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 1, delay: 0.5, ease }}
        >
          Davčna Skladnost
        </motion.div>

        <motion.h2 
          className="text-[3.5vw] font-bold font-['Plus_Jakarta_Sans'] text-center max-w-[80vw] leading-tight mb-[6vw]"
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1.2, delay: 0.8, ease }}
        >
          Pravila se spreminjajo, <br/>
          <span className="text-brand-gray text-[3vw] font-normal">vaše poslovanje ostaja varno.</span>
        </motion.h2>

        <div className="flex gap-[3vw] px-[10vw] w-full justify-center">
          {items.map((item, index) => (
            <motion.div 
              key={index}
              className="flex-1 bg-gradient-to-b from-slate-800 to-slate-900 border border-slate-700 p-[3vw] rounded-2xl flex flex-col items-center text-center relative overflow-hidden"
              initial={{ opacity: 0, y: 50, scale: 0.9 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ duration: 1.2, delay: 1.5 + index * 0.3, ease }}
            >
              <motion.div 
                className="absolute inset-0 bg-brand-green mix-blend-overlay opacity-0"
                animate={{ opacity: [0, 0.2, 0] }}
                transition={{ duration: 1, delay: 2 + index * 0.3, ease }}
              />

              <div className="w-[5vw] h-[5vw] rounded-full bg-slate-700/50 flex items-center justify-center mb-[2vw] relative">
                <motion.div 
                  className="absolute inset-0 border-2 border-brand-green rounded-full"
                  initial={{ scale: 1.5, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ duration: 0.8, delay: 2.2 + index * 0.3, ease }}
                />
                <svg className="w-[2.5vw] h-[2.5vw] text-brand-green" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>

              <h3 className="text-[1.8vw] font-bold text-white mb-[1vw]">{item.title}</h3>
              <div className="w-[3vw] h-[0.2vw] bg-brand-green/50 rounded-full mx-auto" />
            </motion.div>
          ))}
        </div>

        <motion.div 
          className="absolute bottom-[10vh] text-[1.5vw] text-slate-400 font-medium"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 1, delay: 3.5, ease }}
        >
          Vse <span className="text-white font-bold">avtomatsko</span>.
        </motion.div>

      </div>
    </motion.div>
  );
}