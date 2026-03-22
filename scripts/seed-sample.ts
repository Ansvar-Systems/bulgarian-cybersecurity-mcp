/**
 * Seed the CERT-BG database with sample guidance documents, advisories, and
 * frameworks for testing.
 *
 * Usage:
 *   npx tsx scripts/seed-sample.ts
 *   npx tsx scripts/seed-sample.ts --force   # drop and recreate
 */

import Database from "better-sqlite3";
import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";
import { SCHEMA_SQL } from "../src/db.js";

const DB_PATH = process.env["CERT_BG_DB_PATH"] ?? "data/cert-bg.db";
const force = process.argv.includes("--force");

const dir = dirname(DB_PATH);
if (!existsSync(dir)) {
  mkdirSync(dir, { recursive: true });
}

if (force && existsSync(DB_PATH)) {
  unlinkSync(DB_PATH);
  console.log(`Deleted existing database at ${DB_PATH}`);
}

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.exec(SCHEMA_SQL);

console.log(`Database initialised at ${DB_PATH}`);

// --- Frameworks --------------------------------------------------------------

const frameworks = [
  {
    id: "cert-bg",
    name: "CERT-BG Насоки и препоръки",
    name_en: "CERT-BG Guidelines and Recommendations",
    description: "Официалните насоки и технически препоръки на CERT-BG за защита на информационни системи, реакция при инциденти и управление на киберрискове.",
    document_count: 18,
  },
  {
    id: "dans",
    name: "ДАНС — Препоръки за киберсигурност",
    name_en: "DANS — Cybersecurity Recommendations",
    description: "Препоръки на Държавна агенция 'Национална сигурност' за защита на класифицирана информация и критична инфраструктура.",
    document_count: 12,
  },
  {
    id: "nis2",
    name: "NIS2 — Национално прилагане",
    name_en: "NIS2 — National Implementation",
    description: "Материали за прилагане на Директива (ЕС) 2022/2555 (NIS2) в България.",
    document_count: 8,
  },
];

const insertFramework = db.prepare(
  "INSERT OR IGNORE INTO frameworks (id, name, name_en, description, document_count) VALUES (?, ?, ?, ?, ?)",
);
for (const f of frameworks) {
  insertFramework.run(f.id, f.name, f.name_en, f.description, f.document_count);
}
console.log(`Inserted ${frameworks.length} frameworks`);

// --- Guidance ----------------------------------------------------------------

const guidance = [
  {
    reference: "CERT-BG-G-2023-001",
    title: "Насоки за управление на инциденти с информационна сигурност",
    title_en: "Guidelines for Information Security Incident Management",
    date: "2023-03-15",
    type: "guideline",
    series: "CERT-BG",
    summary: "Насоките описват процедурите за идентифициране, класифициране, реакция и докладване на инциденти с информационна сигурност.",
    full_text: "CERT-BG публикува настоящите насоки за управление на инциденти. Инцидентите се класифицират по категории: поверителност, интегритет, наличност и автентичност с тежест от 1 (ниска) до 4 (критична). При критични инциденти организацията трябва да изолира засегнатите системи и да уведоми CERT-BG в рамките на 24 часа. Операторите на основни услуги са длъжни да докладват значими инциденти в рамките на 72 часа. CERT-BG координира реакцията при мащабни инциденти с националните компетентни органи и международни CERT организации. След разрешаване на инцидента организациите трябва да проведат анализ на основните причини.",
    topics: JSON.stringify(["incident_response", "reporting", "NIS2"]),
    status: "current",
  },
  {
    reference: "CERT-BG-G-2023-002",
    title: "Технически насоки за защита на уеб приложения",
    title_en: "Technical Guidelines for Web Application Security",
    date: "2023-06-20",
    type: "guideline",
    series: "CERT-BG",
    summary: "Технически насоки за сигурна разработка и поддръжка на уеб приложения, използвани в публичния сектор на България.",
    full_text: "CERT-BG публикува технически насоки за защита на уеб приложения, базирани на OWASP ASVS. Изисквания: всички административни интерфейси изискват двуфакторна автентикация; сесийните токени трябва да са с минимална ентропия от 128 бита; параметризираните заявки са задължителни за предотвратяване на SQL инжекции; всички уеб приложения трябва да използват TLS 1.2 или по-нова версия; всички автентикационни опити и административни действия се регистрират в защитени одитни журнали.",
    topics: JSON.stringify(["web_security", "OWASP", "authentication", "TLS"]),
    status: "current",
  },
  {
    reference: "CERT-BG-G-2022-003",
    title: "Насоки за защита на критична информационна инфраструктура",
    title_en: "Guidelines for Critical Information Infrastructure Protection",
    date: "2022-11-10",
    type: "guideline",
    series: "CERT-BG",
    summary: "Насоки за идентифициране, оценка и защита на критичната информационна инфраструктура в България.",
    full_text: "CERT-BG публикува насоки за защита на критичната информационна инфраструктура в секторите: енергетика, транспорт, финансови услуги, здравеопазване и водоснабдяване. Минимални изисквания: актуален регистър на ИТ активи; годишна оценка на риска; сегментиране на OT от корпоративните мрежи; ежедневно архивиране на критични данни с копие извън основното място; тестван план за непрекъснатост на дейността с RTO не повече от 24 часа за критични системи.",
    topics: JSON.stringify(["critical_infrastructure", "risk_management", "OT_security"]),
    status: "current",
  },
  {
    reference: "DANS-R-2023-001",
    title: "Препоръки за защита на класифицирана информация в информационни системи",
    title_en: "Recommendations for Protection of Classified Information in Information Systems",
    date: "2023-04-05",
    type: "recommendation",
    series: "DANS",
    summary: "Препоръки на ДАНС за техническата и организационна защита на класифицирана информация в автоматизирани информационни системи.",
    full_text: "ДАНС публикува препоръки за защита на класифицирана информация съгласно ЗЗКИ. Изисквания: информационните системи се намират в охранявани зони с електронен контрол на достъпа; принципът на минимални привилегии е задължителен с двуфакторна автентикация; при предаване на класифицирана информация задължително се използват одобрени криптографски алгоритми; за ниво 'Секретно' и по-горе се изисква сертифицирано от ДАНС криптографско оборудване; всички операции с класифицирана информация се регистрират в защитени журнали, съхранявани минимум 5 години.",
    topics: JSON.stringify(["classified_information", "access_control", "encryption"]),
    status: "current",
  },
  {
    reference: "NIS2-BG-2024-001",
    title: "Ръководство за прилагане на NIS2 изисквания в България",
    title_en: "Guide for Implementation of NIS2 Requirements in Bulgaria",
    date: "2024-01-17",
    type: "guideline",
    series: "NIS2",
    summary: "Практическо ръководство за операторите на основни и важни услуги в България за прилагане на изискванията на Директива NIS2.",
    full_text: "CERT-BG и КРС публикуват ръководство за прилагане на Директива (ЕС) 2022/2555 (NIS2) в България. Операторите трябва да се регистрират до 17 февруари 2025 г. Задължения: управление на риска включващо политики за информационна сигурност, управление на активи и контрол на достъпа; оценка на рисковете от доставчиците с изисквания за сигурност в договорите; ранно предупреждение за инциденти в рамките на 24 часа, пълен доклад в рамките на 72 часа. Санкции при неспазване: до 10 000 000 евро или 2% от годишния оборот за оператори на основни услуги.",
    topics: JSON.stringify(["NIS2", "risk_management", "incident_reporting", "supply_chain"]),
    status: "current",
  },
];

const insertGuidance = db.prepare(
  "INSERT OR IGNORE INTO guidance (reference, title, title_en, date, type, series, summary, full_text, topics, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
);
const insertGuidanceAll = db.transaction(() => {
  for (const g of guidance) {
    insertGuidance.run(g.reference, g.title, g.title_en, g.date, g.type, g.series, g.summary, g.full_text, g.topics, g.status);
  }
});
insertGuidanceAll();
console.log(`Inserted ${guidance.length} guidance documents`);

// --- Advisories --------------------------------------------------------------

const advisories = [
  {
    reference: "CERT-BG-A-2024-001",
    title: "Критична уязвимост в Ivanti Connect Secure VPN",
    date: "2024-01-12",
    severity: "critical",
    affected_products: JSON.stringify(["Ivanti Connect Secure", "Ivanti Policy Secure"]),
    summary: "CERT-BG предупреждава за активно използвани критични уязвимости в Ivanti Connect Secure и Policy Secure VPN продукти.",
    full_text: "CERT-BG е открил активна експлоатация на CVE-2023-46805 и CVE-2024-21887 в Ivanti Connect Secure и Policy Secure. Засегнати версии 9.x и 22.x. Мерки: незабавно приложете наличните пачове; проверете системните журнали за признаци на компрометиране; при съмнение изолирайте засегнатите системи и докладвайте на CERT-BG.",
    cve_references: JSON.stringify(["CVE-2023-46805", "CVE-2024-21887"]),
  },
  {
    reference: "CERT-BG-A-2024-002",
    title: "Рансъмуер кампания срещу здравни организации в България",
    date: "2024-03-08",
    severity: "high",
    affected_products: JSON.stringify(["Windows Server 2016/2019", "VMware ESXi"]),
    summary: "CERT-BG предупреждава за засилена активност на рансъмуер групи, насочени срещу здравни организации в България.",
    full_text: "CERT-BG е получил доклади за множество рансъмуер инциденти в здравни организации в България с варианти на LockBit и ALPHV. Вектори: фишинг имейли, брутфорс срещу RDP, уязвимости в VPN. Мерки: деактивирайте RDP; приложете MFA; проверете резервните копия; обучете персонала. При инцидент — не плащайте откуп и се свържете с CERT-BG.",
    cve_references: JSON.stringify([]),
  },
  {
    reference: "CERT-BG-A-2023-015",
    title: "Уязвимост в OpenSSL — препоръки за актуализация",
    date: "2023-11-02",
    severity: "high",
    affected_products: JSON.stringify(["OpenSSL 3.0.x", "OpenSSL 3.1.x"]),
    summary: "CERT-BG препоръчва незабавна актуализация на OpenSSL поради критична уязвимост CVE-2023-5678.",
    full_text: "OpenSSL публикува версии 3.0.12 и 3.1.4, отстраняващи CVE-2023-5678 в обработката на Diffie-Hellman параметри. Уязвимостта може да предизвика DoS. OpenSSL 1.0.2 и 1.1.1 не са засегнати. Препоръки: актуализирайте незабавно; идентифицирайте всички приложения, използващи OpenSSL; рестартирайте услугите след актуализацията.",
    cve_references: JSON.stringify(["CVE-2023-5678"]),
  },
];

const insertAdvisory = db.prepare(
  "INSERT OR IGNORE INTO advisories (reference, title, date, severity, affected_products, summary, full_text, cve_references) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
);
const insertAdvisoriesAll = db.transaction(() => {
  for (const a of advisories) {
    insertAdvisory.run(a.reference, a.title, a.date, a.severity, a.affected_products, a.summary, a.full_text, a.cve_references);
  }
});
insertAdvisoriesAll();
console.log(`Inserted ${advisories.length} advisories`);

// --- Summary -----------------------------------------------------------------

const guidanceCount = (db.prepare("SELECT count(*) as cnt FROM guidance").get() as { cnt: number }).cnt;
const advisoryCount = (db.prepare("SELECT count(*) as cnt FROM advisories").get() as { cnt: number }).cnt;
const frameworkCount = (db.prepare("SELECT count(*) as cnt FROM frameworks").get() as { cnt: number }).cnt;

console.log(`\nDatabase summary:`);
console.log(`  Frameworks: ${frameworkCount}`);
console.log(`  Guidance:   ${guidanceCount}`);
console.log(`  Advisories: ${advisoryCount}`);
console.log(`\nDone. Database ready at ${DB_PATH}`);

db.close();
