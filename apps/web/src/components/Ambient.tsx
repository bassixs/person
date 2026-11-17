import { useEffect } from "react";

/** Живой фон тёмной темы снят (E-021): в светлом стиле фон — чистая «бумага». Компонент оставлен как точка расширения. */
export function Ambient() {
  return null;
}

/** Страница сообщает интенсивность фона: на главной заметнее, в рабочих разделах тише. */
export function useAmbient(level: "high" | "low") {
  useEffect(() => {
    document.body.dataset.ambient = level;
  }, [level]);
}
