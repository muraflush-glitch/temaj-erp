# Prova që punon brenda shfletuesit

Një faqe e vetme ku punon **i njëjti kod** i API-së (`apps/api/src`) dhe i ndërfaqes (`apps/web/app`), pa server:
databaza është PostgreSQL i kompiluar në WebAssembly (PGlite) dhe mbi të ekzekutohen të njëjtat migrime, me të njëjtat rregulla.

- Vetëm për demonstrim. Të dhënat janë testuese, jetojnë në memorien e skedës dhe fshihen kur faqja mbyllet ose rifreskohet.
- Nuk është mjedis pune: një pajisje, një përdorues njëkohësisht, pa kopje rezervë.
- Butoni "Aprovuesi (personi i dytë)" kyç përdoruesin e dytë me 2FA, që aprovimet të provohen pa telefon. Kjo ekziston vetëm këtu.

```
npm run demo:build        # krijon apps/demo/dist (index.html + 4 skedarë .js)
node apps/demo/e2e.mjs    # testi me Chrome: 17 hapa, pa asnjë kërkesë në rrjet
```

Si funksionon: `shims/` zëvendëson NestJS (dekoratorët regjistrojnë rrugët), `pg` (adaptor mbi PGlite), `crypto` të Node (@noble, të njëjtat algoritme)
dhe navigimin e Next.js (pjesa `#...` e adresës). `src/backend.ts` ndërton shërbimet dhe zbaton të njëjtat kontrolle si serveri: sesioni, lejet, validimi, kodet e gabimeve.
