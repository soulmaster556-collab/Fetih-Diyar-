// 10 lonca bayrağı: TEK bir bayrak şablonu (direk + kırlangıç kuyruklu
// flama), her biri farklı renk gradyanı + farklı sade amblemle ayrışıyor.
// Sunucu sadece 1-10 arası flagId saklıyor (bkz. guilds.ts), görselin
// kendisi tamamen client'ta üretiliyor.
export const GUILD_FLAG_DEFS: { id: number; name: string; colors: [string, string]; emblem: string }[] = [
  { id: 1, name: "Kızıl Şahin", colors: ["#e5484d", "#8a1f22"], emblem: "star" },
  { id: 2, name: "Derin Deniz", colors: ["#2f8fd6", "#12466e"], emblem: "wave" },
  { id: 3, name: "Orman Yemini", colors: ["#3fae5c", "#1c5c30"], emblem: "tree" },
  { id: 4, name: "Altın Taç", colors: ["#f0b429", "#a5720f"], emblem: "diamond" },
  { id: 5, name: "Gece Ayı", colors: ["#6b5ecb", "#332a72"], emblem: "moon" },
  { id: 6, name: "Demir Kule", colors: ["#7c8b96", "#3d474e"], emblem: "tower" },
  { id: 7, name: "Kutsal Yemin", colors: ["#e8e2d0", "#a89f7e"], emblem: "cross" },
  { id: 8, name: "Kum Fırtınası", colors: ["#d99a4e", "#8a5a20"], emblem: "sun" },
  { id: 9, name: "Kurt Sürüsü", colors: ["#5a6b7a", "#232f38"], emblem: "paw" },
  { id: 10, name: "Kan Kardeşliği", colors: ["#c23a5e", "#661f34"], emblem: "stripe" },
];
