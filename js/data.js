/**
 * Alters- und Schlafdaten.
 *
 * Zur Herkunft der Zahlen - drei verschiedene Belastbarkeiten:
 *
 * 1. Gesamtschlafdauer je 24 h (guideline): Konsens der American Academy of
 *    Sleep Medicine (Paruthi et al. 2016, von der AAP mitgetragen) für 4 Monate
 *    bis 5 Jahre; darunter die Werte der National Sleep Foundation
 *    (Hirshkowitz et al. 2015), weil die AASM für unter 4 Monate bewusst keine
 *    Empfehlung ausspricht.
 * 2. Anzahl der Nickerchen und die Übergänge: Meta-Analyse von Staton et al.
 *    2020 ("Many naps, one nap, none", Sleep Medicine Reviews) sowie die
 *    Referenzkurven von Iglowstein et al. 2003 (Pediatrics).
 * 3. Wachfenster (wakeWindowMin/Max) und Nickerchenlänge: PRAXISWERTE aus der
 *    Schlafberatung. Für Wachfenster als solche gibt es KEINE peer-reviewte
 *    Evidenz - das Konzept leitet sich vom Schlafdruck-Modell und den
 *    Gesamtschlafmengen ab, die individuelle Streuung ist groß. Genau deshalb
 *    lernt Schlummer diese Werte aus den eigenen Daten (js/learning.js).
 *
 * Alle Werte sind Orientierung, kein medizinischer Rat.
 * minAgeDays gilt jeweils "ab", die Bänder sind aufsteigend sortiert.
 */

/** Quellenangaben, die in der App unter "Mehr" angezeigt werden. */
export const SOURCES = [
  {
    topic: 'Was diese App nicht hat',
    text: 'Schlummer ist nicht medizinisch gegengelesen. Kommerzielle Apps lassen ihre Inhalte von Fachleuten prüfen (Napper etwa von einer Kinderärztin am Karolinska-Institut) und gleichen ihre Vorhersagen zusätzlich an Millionen Einträgen anderer Familien ab. Beides fehlt hier: Es gibt nur die veröffentlichten Richtwerte unten und die Einträge deines eigenen Kindes.',
    url: '',
    strength: 'Einordnung'
  },
  {
    topic: 'Gesamtschlafdauer 4 Monate bis 5 Jahre',
    text: 'AASM-Konsens (Paruthi et al. 2016, J Clin Sleep Med): 4-12 Monate 12-16 h, 1-2 Jahre 11-14 h, 3-5 Jahre 10-13 h - jeweils inklusive Nickerchen. Für Säuglinge unter 4 Monaten gibt die AASM ausdrücklich keine Empfehlung ab (zu große normale Streuung).',
    url: 'https://jcsm.aasm.org/doi/10.5664/jcsm.5866',
    strength: 'Leitlinie'
  },
  {
    topic: 'Gesamtschlafdauer 0-3 Monate',
    text: 'National Sleep Foundation (Hirshkowitz et al. 2015): Neugeborene 14-17 h pro 24 Stunden.',
    url: 'https://www.sleephealthjournal.org/article/S2352-7218(15)00015-7/fulltext',
    strength: 'Expertenkonsens'
  },
  {
    topic: 'Stunden pro Alter (Übersichtstabelle)',
    text: 'Stanford Medicine Children\'s Health, "Infant Sleep": Neugeborene rund 16 Stunden, mit 6 Monaten etwa 14, mit 2 Jahren etwa 13 Stunden pro Tag. Diese Übersicht ist die gängige Grundlage für Alterstabellen in Eltern-Apps und deckt sich mit den Werten hier.',
    url: 'https://www.stanfordchildrens.org/en/topic/default?id=infant-sleep-90-P02237',
    strength: 'Klinik-Übersicht'
  },
  {
    topic: 'Referenzwerte und Streuung',
    text: 'Iglowstein et al. 2003 (Pediatrics, Zürcher Längsschnitt, 493 Kinder): Gesamtschlaf im Mittel 14,2 h mit 6 Monaten, 8,1 h mit 16 Jahren. Galland et al. 2012 (Sleep Med Rev, systematische Übersicht): Säuglinge im Mittel 12,8 h, normale Spanne 9,7-15,9 h - die Streuung zwischen Kindern ist also riesig.',
    url: 'https://publications.aap.org/pediatrics/article/111/2/302/66745/',
    strength: 'Beobachtungsstudien'
  },
  {
    topic: 'Anzahl der Nickerchen und Nap-Übergänge',
    text: 'Staton et al. 2020 (Sleep Med Rev, Meta-Analyse zu Nickerchen bei 0-12-Jährigen): weniger als 2,5 % der Kinder hören vor dem 2. Geburtstag mit Nickerchen auf, 23-44 % bis 3 Jahre, 94 % bis 5 Jahre. Der Wechsel von drei auf zwei Nickerchen liegt üblicherweise bei 6,5-8 Monaten, der von zwei auf eins bei 13-18 Monaten.',
    url: 'https://www.sciencedirect.com/science/article/abs/pii/S1087079219302151',
    strength: 'Meta-Analyse'
  },
  {
    topic: 'Nächtliches Aufwachen (Vergleichswerte)',
    text: 'Paavonen et al. 2020 (Sleep Medicine, zwei finnische Geburtskohorten mit 950 bis 2002 Kindern je Alter): Mit 6 Monaten wachen Babys im Schnitt 2,5-mal pro Nacht auf, mit 8 Monaten 2,4-mal, mit 12 Monaten 1,8-mal. Die Autoren empfehlen das Gespräch in der Vorsorge, wenn ein 6 Monate altes Kind regelmäßig dreimal oder öfter wach wird, ein 8 Monate altes länger als 40 Minuten zum Einschlafen braucht oder nachts länger als 60 Minuten am Stück wach ist (12 Monate: 45 Minuten, 18 Monate: 30 Minuten).',
    url: 'https://pubmed.ncbi.nlm.nih.gov/32087408/',
    strength: 'Kohortenstudie'
  },
  {
    topic: 'Wachfenster',
    text: 'Für Wachfenster gibt es keine peer-reviewten Studien - der Begriff stammt aus der Schlafberatung (verbreitet über Taking Cara Babies, Dr. Craig Canapari und ähnliche Praxisquellen). Theoretisch begründet sind sie über den Schlafdruck (Adenosin-Aufbau im Wachzustand) und die bekannten Gesamtschlafmengen. Die Werte hier sind gängige Praxiswerte und der Startpunkt, von dem aus Schlummer die tatsächlichen Wachfenster deines Kindes lernt. Kommerzielle Apps halten es genauso: Tabelle als Start, Kalibrierung an den echten Einträgen.',
    url: '',
    strength: 'Praxiswert, nicht belegt'
  },
  {
    topic: 'Was bei nächtlichem Aufwachen hilft',
    text: 'Die Hinweise in der Karte "Wachphasen" stammen aus der Elternberatung und aus Übersichtsarbeiten zu verhaltensbezogenen Einschlafhilfen (Mindell et al., Sleep 2006, AASM-Übersicht zu Bedtime Problems und Night Wakings; Mindell et al. 2009 zur abendlichen Routine). Belegt ist vor allem, dass eine gleichbleibende Abendroutine das Einschlafen und Durchschlafen verbessert. Für die einzelnen Handgriffe gilt: Praxisempfehlung, keine Garantie - Kinder sind verschieden. Halten unruhige Nächte über Wochen an, gehört das in die Vorsorgeuntersuchung.',
    url: '',
    strength: 'Übersichtsarbeit + Praxis'
  },
  {
    topic: 'Lautstärke von Einschlafgeräuschen',
    text: 'Hugh et al. 2014 (Pediatrics): Alle 14 getesteten Einschlafgeräte überschritten bei voller Lautstärke in 30 cm Abstand 50 dB(A) - den für Neugeborenenstationen empfohlenen Grenzwert; drei Geräte lagen über 85 dB(A). Empfehlung: möglichst leise, mindestens 200 cm Abstand zum Bett, nicht die ganze Nacht auf voller Lautstärke.',
    url: 'https://publications.aap.org/pediatrics/article/133/4/677/32749/',
    strength: 'Studie'
  },
  {
    topic: 'Sichere Schlafumgebung',
    text: 'kindergesundheit-info.de (Bundeszentrale für gesundheitliche Aufklärung): Rückenlage, Schlafsack statt Decke, eigenes Babybett im Elternschlafzimmer, keine Kissen, Decken oder Nestchen, rauchfreie Umgebung, Zimmertemperatur nicht über 18 °C.',
    url: 'https://www.kindergesundheit-info.de/themen/schlafen/0-12-monate/schlafumgebung/sicher-schlafen/',
    strength: 'Behörde'
  }
];

/** Empfohlene Gesamtschlafdauer je 24 h (Stunden) samt Quelle. */
const GUIDE_NSF = { min: 14, max: 17, source: 'NSF 2015 (0-3 Mon.)' };
const GUIDE_NSF_INFANT = { min: 12, max: 17, source: 'NSF/AASM (Übergang 3-4 Mon.)' };
const GUIDE_AASM_INFANT = { min: 12, max: 16, source: 'AASM 2016 (4-12 Mon.)' };
const GUIDE_AASM_TODDLER = { min: 11, max: 14, source: 'AASM 2016 (1-2 J.)' };
const GUIDE_AASM_PRESCHOOL = { min: 10, max: 13, source: 'AASM 2016 (3-5 J.)' };

export const AGE_BANDS = [
  {
    id: 'nb',
    label: '0-4 Wochen',
    minAgeDays: 0,
    wakeWindowMin: 35,
    wakeWindowMax: 60,
    naps: 5,
    napLengthMin: 45,
    dayTimeSleepMin: 480,
    nightSleepMin: 510,
    bedtimeEarliest: '20:00',
    bedtimeLatest: '22:00',
    guideline: GUIDE_NSF,
    note: 'Neugeborene schlafen rund um die Uhr in kurzen Blöcken. Ein fester Plan ist noch nicht sinnvoll - orientiere dich an Müdigkeitszeichen. Die AASM gibt für dieses Alter bewusst keine Schlafempfehlung.'
  },
  {
    id: 'w4',
    label: '1-2 Monate',
    minAgeDays: 28,
    wakeWindowMin: 60,
    wakeWindowMax: 90,
    naps: 4,
    napLengthMin: 60,
    dayTimeSleepMin: 390,
    nightSleepMin: 540,
    bedtimeEarliest: '19:30',
    bedtimeLatest: '21:30',
    guideline: GUIDE_NSF,
    note: 'Erste Rhythmen entstehen. Der Abend darf noch später liegen als später im ersten Jahr.'
  },
  {
    id: 'm2',
    label: '2-3 Monate',
    minAgeDays: 61,
    wakeWindowMin: 75,
    wakeWindowMax: 105,
    naps: 4,
    napLengthMin: 60,
    dayTimeSleepMin: 330,
    nightSleepMin: 600,
    bedtimeEarliest: '19:00',
    bedtimeLatest: '21:00',
    guideline: GUIDE_NSF,
    note: 'Der Tag-Nacht-Rhythmus festigt sich. Tageslicht am Morgen hilft dabei.'
  },
  {
    id: 'm3',
    label: '3-4 Monate',
    minAgeDays: 91,
    wakeWindowMin: 90,
    wakeWindowMax: 120,
    naps: 4,
    napLengthMin: 55,
    dayTimeSleepMin: 270,
    nightSleepMin: 630,
    bedtimeEarliest: '18:30',
    bedtimeLatest: '20:30',
    guideline: GUIDE_NSF_INFANT,
    note: 'Rund um 4 Monate reift der Schlaf um (häufig "4-Monats-Regression"). Kurze Nickerchen sind jetzt normal.'
  },
  {
    id: 'm4',
    label: '4-5 Monate',
    minAgeDays: 121,
    wakeWindowMin: 105,
    wakeWindowMax: 135,
    naps: 3,
    napLengthMin: 70,
    dayTimeSleepMin: 240,
    nightSleepMin: 660,
    bedtimeEarliest: '18:30',
    bedtimeLatest: '20:00',
    guideline: GUIDE_AASM_INFANT,
    note: 'Drei bis vier Nickerchen. Das letzte Wachfenster vor der Nacht ist meist das längste.'
  },
  {
    id: 'm5',
    label: '5-6 Monate',
    minAgeDays: 152,
    wakeWindowMin: 120,
    wakeWindowMax: 150,
    naps: 3,
    napLengthMin: 75,
    dayTimeSleepMin: 210,
    nightSleepMin: 660,
    bedtimeEarliest: '18:30',
    bedtimeLatest: '20:00',
    guideline: GUIDE_AASM_INFANT,
    note: 'Drei Nickerchen, das dritte oft nur ein kurzes Katzenschläfchen am späten Nachmittag.'
  },
  {
    id: 'm6',
    label: '6-8 Monate',
    minAgeDays: 182,
    wakeWindowMin: 135,
    wakeWindowMax: 165,
    naps: 3,
    napLengthMin: 75,
    dayTimeSleepMin: 180,
    nightSleepMin: 660,
    bedtimeEarliest: '18:30',
    bedtimeLatest: '20:00',
    guideline: GUIDE_AASM_INFANT,
    note: 'In diesem Alter fällt meist das dritte Nickerchen weg - der Übergang liegt laut Meta-Analyse typischerweise zwischen 6,5 und 8 Monaten. An Tagen mit kurzen Nickerchen hilft eine frühere Bettzeit.'
  },
  {
    id: 'm8',
    label: '8-10 Monate',
    minAgeDays: 244,
    wakeWindowMin: 150,
    wakeWindowMax: 195,
    naps: 2,
    napLengthMin: 85,
    dayTimeSleepMin: 165,
    nightSleepMin: 660,
    bedtimeEarliest: '18:30',
    bedtimeLatest: '20:00',
    guideline: GUIDE_AASM_INFANT,
    note: 'Zwei Nickerchen (Vormittag und früher Nachmittag) sind jetzt der Normalfall.'
  },
  {
    id: 'm10',
    label: '10-12 Monate',
    minAgeDays: 305,
    wakeWindowMin: 165,
    wakeWindowMax: 225,
    naps: 2,
    napLengthMin: 80,
    dayTimeSleepMin: 150,
    nightSleepMin: 660,
    bedtimeEarliest: '18:30',
    bedtimeLatest: '20:00',
    guideline: GUIDE_AASM_INFANT,
    note: 'Manche Kinder streiken kurz beim zweiten Nickerchen - meist ist das nur eine Phase, kein Nap-Übergang.'
  },
  {
    id: 'm12',
    label: '12-15 Monate',
    minAgeDays: 366,
    wakeWindowMin: 195,
    wakeWindowMax: 240,
    naps: 2,
    napLengthMin: 75,
    dayTimeSleepMin: 150,
    nightSleepMin: 660,
    bedtimeEarliest: '18:30',
    bedtimeLatest: '20:00',
    guideline: GUIDE_AASM_TODDLER,
    note: 'Der Wechsel auf ein Nickerchen steht an - laut Forschung meist zwischen 13 und 18 Monaten, am häufigsten mit 14 bis 15 Monaten.'
  },
  {
    id: 'm15',
    label: '15-18 Monate',
    minAgeDays: 457,
    wakeWindowMin: 240,
    wakeWindowMax: 300,
    naps: 1,
    napLengthMin: 130,
    dayTimeSleepMin: 135,
    nightSleepMin: 660,
    bedtimeEarliest: '18:45',
    bedtimeLatest: '20:15',
    guideline: GUIDE_AASM_TODDLER,
    note: 'Ein langes Mittagsschläfchen. Startet es zu früh, wird der Abend lang.'
  },
  {
    id: 'm18',
    label: '18-24 Monate',
    minAgeDays: 548,
    wakeWindowMin: 285,
    wakeWindowMax: 330,
    naps: 1,
    napLengthMin: 120,
    dayTimeSleepMin: 120,
    nightSleepMin: 660,
    bedtimeEarliest: '19:00',
    bedtimeLatest: '20:30',
    guideline: GUIDE_AASM_TODDLER,
    note: 'Mittagsschlaf möglichst nicht nach 15:00 Uhr enden lassen, sonst leidet das Einschlafen abends.'
  },
  {
    id: 'y2',
    label: '2-3 Jahre',
    minAgeDays: 731,
    wakeWindowMin: 300,
    wakeWindowMax: 360,
    naps: 1,
    napLengthMin: 90,
    dayTimeSleepMin: 90,
    nightSleepMin: 660,
    bedtimeEarliest: '19:00',
    bedtimeLatest: '20:30',
    guideline: GUIDE_AASM_TODDLER,
    note: 'Ein kürzeres Mittagsschläfchen reicht jetzt aus. Vor dem 2. Geburtstag hören weniger als 3 % der Kinder ganz mit dem Mittagsschlaf auf.'
  },
  {
    id: 'y3',
    label: '3-4 Jahre',
    minAgeDays: 1096,
    wakeWindowMin: 330,
    wakeWindowMax: 390,
    naps: 1,
    napLengthMin: 75,
    dayTimeSleepMin: 60,
    nightSleepMin: 660,
    bedtimeEarliest: '19:00',
    bedtimeLatest: '20:30',
    guideline: GUIDE_AASM_PRESCHOOL,
    note: 'Etwa ein Drittel der Kinder schläft tagsüber nicht mehr - der Rest braucht noch ein Mittagsschläfchen. Beides ist normal.'
  },
  {
    id: 'y4',
    label: '4-5 Jahre',
    minAgeDays: 1461,
    wakeWindowMin: 360,
    wakeWindowMax: 420,
    naps: 0,
    napLengthMin: 60,
    dayTimeSleepMin: 0,
    nightSleepMin: 660,
    bedtimeEarliest: '19:00',
    bedtimeLatest: '20:30',
    guideline: GUIDE_AASM_PRESCHOOL,
    note: 'Die meisten Kinder schlafen tagsüber nicht mehr. Eine ruhige Pause am Nachmittag tut trotzdem gut.'
  }
];

/**
 * Normwerte für nächtliches Aufwachen.
 *
 * Quelle: Paavonen et al. 2020, "Normal sleep development in infants: findings
 * from two large birth cohorts" (Sleep Medicine 69:145-154). Zwei finnische
 * Geburtskohorten, je nach Alter 950 bis 2002 Kinder.
 *
 * Bewusst NUR die Alter, für die belegte Zahlen vorliegen - dazwischen wird
 * nicht interpoliert, sondern der nächstgelegene Ankerwert gezeigt und als
 * solcher benannt.
 */
export const NIGHT_NORMS = {
  source: 'Paavonen et al. 2020 (CHILD-SLEEP und FinnBrain, 950-2002 Kinder je Alter)',
  url: 'https://pubmed.ncbi.nlm.nih.gov/32087408/',
  /** Durchschnittliche Anzahl nächtlicher Aufwachereignisse. */
  wakings: [
    { months: 6, mean: 2.5 },
    { months: 8, mean: 2.4 },
    { months: 12, mean: 1.8 }
  ],
  /** Grenzen, ab denen die Autoren das Gespräch in der Vorsorge empfehlen. */
  clinicHints: [
    { months: 6, text: 'Mit 6 Monaten regelmäßig dreimal oder öfter wach' },
    { months: 8, text: 'Mit 8 Monaten länger als 40 Minuten zum Einschlafen' },
    { months: 8, text: 'Mit 8 Monaten nachts länger als 60 Minuten am Stück wach' },
    { months: 12, text: 'Mit 12 Monaten nachts länger als 45 Minuten am Stück wach' },
    { months: 18, text: 'Mit 18 Monaten nachts länger als 30 Minuten am Stück wach' }
  ]
};

/**
 * Bewertung eines Schlafs. Zwei Fragen, je drei Antworten - mehr will
 * niemand um 3 Uhr nachts auf dem Handy tippen.
 */
export const RATING = {
  settle: {
    question: 'Wie lief das Einschlafen?',
    options: [
      { id: 'fast', emoji: '😴', label: 'Schnell', hint: 'unter 10 Min' },
      { id: 'ok', emoji: '🙂', label: 'Normal', hint: '10-20 Min' },
      { id: 'slow', emoji: '😣', label: 'Schwer', hint: 'über 20 Min, viel Quengeln' }
    ]
  },
  wakings: {
    question: 'Wie oft war dein Kind nachts wach?',
    options: [
      { id: '0', emoji: '🌙', label: 'Durchgeschlafen', hint: 'gar nicht wach' },
      { id: '1', emoji: '1️⃣', label: 'Einmal', hint: '' },
      { id: '2', emoji: '2️⃣', label: 'Zweimal', hint: '' },
      { id: '3', emoji: '3️⃣', label: 'Dreimal', hint: '' },
      { id: '4', emoji: '🔁', label: 'Vier oder öfter', hint: '' }
    ]
  },
  mood: {
    question: 'Wie war das Aufwachen?',
    options: [
      { id: 'happy', emoji: '☀️', label: 'Ausgeschlafen', hint: 'zufrieden wach' },
      { id: 'ok', emoji: '😐', label: 'Geht so', hint: 'kurz gequengelt' },
      { id: 'grumpy', emoji: '😢', label: 'Quengelig', hint: 'weinend, noch müde' }
    ]
  }
};

/** Text-Bausteine für die Müdigkeitszeichen-Hilfe. */
export const TIRED_SIGNS = [
  'Blick wird starr, das Kind "schaut ins Leere"',
  'Gähnen, Augen reiben, an den Ohren ziehen',
  'Fahrige Bewegungen, Nuckeln, Kopf wegdrehen',
  'Quengeln, überdrehtes Kreischen (schon spät)',
  'Untröstliches Weinen (übermüdet - jetzt beruhigen statt bespaßen)'
];
