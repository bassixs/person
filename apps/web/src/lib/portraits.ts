/**
 * Портреты исходных персон (стилизованные 3D, сгенерированы владельцем; файлы в public/personas).
 * Сопоставление по отображаемому имени — инженерное допущение (E-021): у персоны пока нет поля «изображение».
 * Для остальных персон показываются инициалы.
 */
const FILES: Record<string, { file: string; color: string }> = {
  "Артем Вишнев": { file: "01-artem.webp", color: "#3d6bff" },
  "Любовь Богданова": { file: "02-lyubov.webp", color: "#2fae64" },
  "Галина Воронова": { file: "03-galina.webp", color: "#a64dff" },
  "Андрей Бочаров": { file: "04-andrey.webp", color: "#f2a516" },
  "Валентина Абрамова": { file: "05-valentina.webp", color: "#13a8a0" },
  "Игорь Давыдов": { file: "06-igor.webp", color: "#ff5a1f" },
  "Вадим Мельников": { file: "07-vadim.webp", color: "#5b5ff0" },
};

export function portraitFor(name: string): { src: string; color: string } | null {
  const hit = FILES[name.trim()];
  return hit ? { src: `${import.meta.env.BASE_URL}personas/${hit.file}`, color: hit.color } : null;
}
