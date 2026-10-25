// ============ COLLEGES ============
const colleges = [
  { code: 'CBAPA',  name: 'College of Business, Accountancy and Public Administration', dean: 'Dr. Eva U. Cammayo',                email: 'cbapa@isu.edu.ph' },
  { code: 'COE',    name: 'College of Engineering',                                     dean: 'Dr. Rafael J. Padre',               email: 'coe@isu.edu.ph' },
  { code: 'CA',     name: 'College of Agriculture',                                     dean: 'Dr. Artemio A. Martin, Jr.',        email: 'ca@isu.edu.ph' },
  { code: 'CAS',    name: 'College of Arts and Sciences',                               dean: 'Dr. Juanito P. Tandoc, Jr.',        email: 'cas@isu.edu.ph' },
  { code: 'COED',   name: 'College of Education',                                       dean: 'Dr. Nerissa P. Batoon',             email: null },
  { code: 'CCSICT', name: 'College of Computing Studies, Information and Communication Technology', dean: 'Dr. Christine Charmaine G. San Jose', email: 'ccsict@isu.edu.ph' },
  { code: 'CCJE',   name: 'College of Criminal Justice Education',                      dean: 'Dr. Samuel M. Loñez',               email: 'ccje@isu.edu.ph' },
  { code: 'CON',    name: 'College of Nursing',                                         dean: 'Ms. Edmelyn B. Cacayan',            email: 'con@isu.edu.ph' },
  { code: 'SVM',    name: 'School of Veterinary Medicine',                              dean: 'Dr. Jojo D. Cauilan',               email: 'svm@isu.edu.ph' },
  { code: 'IOF',    name: 'Institute of Fisheries',                                     dean: 'Dr. Isagani P. Angeles, Jr.',       email: 'iof@isu.edu.ph' },
];

// ============ PROGRAMS (35) ============
// [program code, program name, college code]
const programs = [
  ['DVM',     'Doctor of Veterinary Medicine',                              'SVM'],
  ['BSAH',    'Bachelor of Science in Animal Husbandry',                    'CA'],
  ['BSAGRI',  'Bachelor of Science in Agriculture',                         'CA'],
  ['BSAGB',   'Bachelor of Science in Agribusiness',                        'CA'],
  ['BSF',     'Bachelor of Science in Forestry',                            'CA'],
  ['BSES',    'Bachelor of Science in Environmental Science',               'CAS'],
  ['BSBIO',   'Bachelor of Science in Biology',                             'CAS'],
  ['BSMATH',  'Bachelor of Science in Mathematics',                         'CAS'],
  ['BECED',   'Bachelor of Early Childhood Education',                      'COED'],
  ['BSCHEM',  'Bachelor of Science in Chemistry',                           'CAS'],
  ['BSPSY',   'Bachelor of Science in Psychology',                          'CAS'],
  ['ABCOM',   'Bachelor of Arts in Communication',                          'CAS'],
  ['ABELS',   'Bachelor of Arts in English Language Studies',               'CAS'],
  ['BSBA',    'Bachelor of Science in Business Administration',             'CBAPA'],
  ['BPA',     'Bachelor in Public Administration',                          'CBAPA'],
  ['BSMA',    'Bachelor of Science in Management Accounting',               'CBAPA'],
  ['BSENT',   'Bachelor of Science in Entrepreneurship',                    'CBAPA'],
  ['BSACCT',  'Bachelor of Science in Accountancy',                         'CBAPA'],
  ['BSHM',    'Bachelor of Science in Hospitality Management',              'CBAPA'],
  ['BSTM',    'Bachelor of Science in Tourism Management',                  'CBAPA'],
  ['BSABE',   'Bachelor of Science in Agricultural and Biosystems Engineering', 'COE'],
  ['BSCE',    'Bachelor of Science in Civil Engineering',                   'COE'],
  ['BEED',    'Bachelor of Elementary Education',                           'COED'],
  ['BSED',    'Bachelor of Secondary Education',                            'COED'],
  ['BPED',    'Bachelor of Physical Education',                             'COED'],
  ['BTLED',   'Bachelor of Technology and Livelihood Education',            'COED'],
  ['BSIT',    'Bachelor of Science in Information Technology',              'CCSICT'],
  ['BSIS',    'Bachelor of Science in Information Systems',                 'CCSICT'],
  ['BSCS',    'Bachelor of Science in Computer Science',                    'CCSICT'],
  ['BSDSA',   'Bachelor of Science in Data Science Analytics',              'CCSICT'],
  ['BLIS',    'Bachelor of Library and Information Science',                'CCSICT'],
  ['BSFAS',   'Bachelor of Science in Fisheries and Aquatic Sciences',      'IOF'],
  ['BSCRIM',  'Bachelor of Science in Criminology',                         'CCJE'],
  ['BSLEA',   'Bachelor of Science in Law Enforcement Administration',     'CCJE'],
  ['BSN',     'Bachelor of Science in Nursing',                             'CON'],
];

// ============ OFFICES (signatories), in signing order ============
const offices = [
  { code: 'INSTR',  name: 'Subject Instructor',                       scope: 'instructor', sort: 1,  desc: 'Confirms no pending requirements in the subject.' },
  { code: 'CHAIR',  name: 'Program Chairperson / Department Head',    scope: 'program',    sort: 2,  desc: 'Confirms the student has no pending departmental obligations.' },
  { code: 'LIB',    name: 'University Library',                       scope: 'university', sort: 3,  desc: 'Confirms all borrowed books are returned and no fines are due.' },
  { code: 'PROP',   name: 'Supply and Property Office',               scope: 'university', sort: 4,  desc: 'Confirms no unreturned equipment or property accountability.' },
  { code: 'HEALTH', name: 'University Health Services',               scope: 'university', sort: 5,  desc: 'Confirms no pending medical or clinic obligations.' },
  { code: 'SSC',    name: 'Supreme Student Council',                  scope: 'university', sort: 6,  desc: 'Confirms student council fees and obligations are settled.' },
  { code: 'GUID',   name: 'Guidance and Counseling Office',           scope: 'university', sort: 7,  desc: 'Confirms no pending guidance or counseling requirements.' },
  { code: 'OSA',    name: 'Office of Student Affairs and Services',   scope: 'university', sort: 8,  desc: 'Confirms no pending disciplinary or student organization issues.' },
  { code: 'CASH',   name: "Cashier's Office",                         scope: 'university', sort: 9,  desc: 'Confirms all fees and financial obligations are settled.' },
  { code: 'DEAN',   name: 'College Dean',                             scope: 'college',    sort: 10, desc: 'Final college-level approval.' },
  { code: 'REG',    name: 'Office of the University Registrar',       scope: 'university', sort: 11, desc: 'Confirms academic records are complete. Final approval.' },
];

// ============ ACADEMIC TERM ============
const terms = [
  { school_year: '2026-2027', semester: '1st Semester', open: '2026-12-01', deadline: '2026-12-20', current: 1 },
];

// ============ SETTINGS ============
const settings = {
  university_name: 'Isabela State University',
  university_address: 'Echague, Isabela, Philippines',
  system_name: 'ISU eClearance',
  clearance_footer: 'This is a system-generated clearance. Verify its authenticity using the QR code.',
};

// ============ DEMO ACCOUNTS (for testing only, delete before going live) ============
const ADMIN_PASSWORD = 'Admin@12345';
const DEMO_PASSWORD = 'Demo@12345';

const demoAdmin = {
  id_number: 'ADMIN-001', email: 'admin@isu-demo.local',
  first_name: 'System', last_name: 'Administrator', position: 'System Administrator',
};

// One demo signatory per office. college/program codes are optional.
const demoSignatories = [
  { id_number: 'EMP-0001', email: 'library@isu-demo.local',   first_name: 'Demo', last_name: 'Librarian',   office: 'LIB',    position: 'University Librarian' },
  { id_number: 'EMP-0002', email: 'property@isu-demo.local',  first_name: 'Demo', last_name: 'Custodian',   office: 'PROP',   position: 'Property Custodian' },
  { id_number: 'EMP-0003', email: 'health@isu-demo.local',    first_name: 'Demo', last_name: 'Nurse',       office: 'HEALTH', position: 'University Nurse' },
  { id_number: 'EMP-0004', email: 'ssc@isu-demo.local',       first_name: 'Demo', last_name: 'SSC Adviser', office: 'SSC',    position: 'SSC Adviser' },
  { id_number: 'EMP-0005', email: 'guidance@isu-demo.local',  first_name: 'Demo', last_name: 'Counselor',   office: 'GUID',   position: 'Guidance Counselor' },
  { id_number: 'EMP-0006', email: 'osa@isu-demo.local',       first_name: 'Demo', last_name: 'OSA Head',    office: 'OSA',    position: 'Director, Student Affairs' },
  { id_number: 'EMP-0007', email: 'cashier@isu-demo.local',   first_name: 'Demo', last_name: 'Cashier',     office: 'CASH',   position: 'Cashier' },
  { id_number: 'EMP-0008', email: 'registrar@isu-demo.local', first_name: 'Demo', last_name: 'Registrar',   office: 'REG',    position: 'University Registrar' },
  { id_number: 'EMP-0009', email: 'dean.ccsict@isu-demo.local', first_name: 'Demo', last_name: 'Dean',      office: 'DEAN',   position: 'Dean, CCSICT', college: 'CCSICT' },
  { id_number: 'EMP-0010', email: 'chair.bsit@isu-demo.local',  first_name: 'Demo', last_name: 'Chairperson', office: 'CHAIR', position: 'Program Chair, BSIT', college: 'CCSICT', program: 'BSIT' },
  { id_number: 'EMP-0011', email: 'instructor1@isu-demo.local', first_name: 'Demo', last_name: 'Instructor One', office: 'INSTR', position: 'Instructor I', college: 'CCSICT' },
  { id_number: 'EMP-0012', email: 'instructor2@isu-demo.local', first_name: 'Demo', last_name: 'Instructor Two', office: 'INSTR', position: 'Assistant Professor', college: 'CCSICT' },
];

const demoStudent = {
  id_number: '2026-00001', email: 'student@isu-demo.local',
  first_name: 'Juan', middle_name: 'Santos', last_name: 'Dela Cruz',
  college: 'CCSICT', program: 'BSIT', year_level: 3,
};

// Subjects for the demo student: [code, title, instructor email]
const demoSubjects = [
  ['IT 301', 'Web Systems and Technologies', 'instructor1@isu-demo.local'],
  ['IT 302', 'Information Assurance and Security', 'instructor2@isu-demo.local'],
];

module.exports = {
  colleges, programs, offices, terms, settings,
  ADMIN_PASSWORD, DEMO_PASSWORD,
  demoAdmin, demoSignatories, demoStudent, demoSubjects,
};