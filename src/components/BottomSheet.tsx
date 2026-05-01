import { motion } from 'framer-motion';

type Props = {
  title: string;
  children: React.ReactNode;
};

export default function BottomSheet({ title, children }: Props) {
  return (
    <motion.section
      className="bottom-sheet"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
    >
      <div className="sheet-handle" />
      <div className="sheet-title-row">
        <h2>{title}</h2>
        <button type="button">Open</button>
      </div>
      {children}
    </motion.section>
  );
}
