// Form field schemas per opportunity. Falls back to DEFAULT.
// Field types: text, email, tel, number, date, textarea, select, radio, checkbox-group.
// A schema is an array of "pages" so we can ship multi-page flows like GOV.BB style.
// For now most are single page but the structure supports more.

const DEFAULT_PERSONAL = [
  { id: "firstName", label: "First name", type: "text", required: true },
  { id: "lastName", label: "Last name", type: "text", required: true },
  { id: "dob", label: "Date of birth", type: "date", required: true, hint: "Used to confirm eligibility" },
  { id: "email", label: "Email address", type: "email", required: true },
  { id: "phone", label: "Phone number", type: "tel", required: true, hint: "Local Barbados number, e.g. 246-555-1234" },
  {
    id: "parish",
    label: "Parish",
    type: "select",
    required: true,
    options: [
      "Christ Church", "Saint Andrew", "Saint George", "Saint James", "Saint John",
      "Saint Joseph", "Saint Lucy", "Saint Michael", "Saint Peter", "Saint Philip", "Saint Thomas",
    ],
  },
  {
    id: "citizenship",
    label: "Citizenship status",
    type: "radio",
    required: true,
    options: ["Barbadian citizen", "Permanent resident", "Other"],
  },
];

const DEFAULT_PAGES = [
  { title: "About you", fields: DEFAULT_PERSONAL },
  {
    title: "Your interest",
    fields: [
      { id: "motivation", label: "Why are you applying?", type: "textarea", required: true, rows: 5, hint: "A short paragraph is fine." },
    ],
  },
];

const SCHEMAS = {
  cip: [
    { title: "About you", fields: DEFAULT_PERSONAL },
    {
      title: "Course preference",
      fields: [
        { id: "course", label: "Which course are you interested in?", type: "text", required: true, hint: "From the available CIP courses (e.g. cookery, cosmetology, sewing)." },
        {
          id: "schedule",
          label: "Preferred session time",
          type: "radio",
          required: true,
          options: ["Morning (10:00 AM)", "Midday (12:30 PM)", "Afternoon (3:00 PM)", "Evening (5:00 PM)"],
        },
        { id: "centre", label: "Nearest community / resource centre", type: "text", hint: "Optional. We'll match you to the closest one if you're unsure." },
      ],
    },
  ],

  cap: [
    { title: "About you", fields: DEFAULT_PERSONAL },
    {
      title: "Art form",
      fields: [
        {
          id: "artForm",
          label: "Which course are you interested in?",
          type: "select",
          required: true,
          options: [
            "Airbrushing", "Animation", "Automotive Painting", "Basic Bodywork",
            "Computer Graphics", "Drawing & Illustration", "Painting & Colour Theory",
            "Sign Making", "Technical Drawing",
          ],
        },
        {
          id: "schedule",
          label: "Preferred session time",
          type: "radio",
          required: true,
          options: ["Morning (10:00 AM–1:00 PM)", "Afternoon (12:30 PM–3:30 PM)", "Evening (5:00 PM–8:00 PM)"],
        },
        { id: "experience", label: "Any prior art experience?", type: "textarea", rows: 4, hint: "Optional. Tell us about any classes, projects, or work you've done." },
      ],
    },
  ],

  byac: [
    { title: "About you", fields: DEFAULT_PERSONAL },
    {
      title: "Background",
      fields: [
        {
          id: "education",
          label: "Highest level of education completed",
          type: "select",
          required: true,
          options: ["Primary", "Some secondary", "Secondary (CSEC)", "CAPE / A-Levels", "Other"],
        },
        { id: "currentlyEmployed", label: "Are you currently working?", type: "radio", required: true, options: ["Yes", "No"] },
        { id: "interests", label: "What skills do you most want to develop?", type: "textarea", rows: 4, required: true },
      ],
    },
    {
      title: "Emergency contact",
      fields: [
        { id: "ecName", label: "Emergency contact name", type: "text", required: true },
        { id: "ecRelationship", label: "Relationship", type: "text", required: true, hint: "e.g. parent, guardian, partner" },
        { id: "ecPhone", label: "Emergency contact phone", type: "tel", required: true },
      ],
    },
  ],

  yes: [
    { title: "About you", fields: DEFAULT_PERSONAL },
    {
      title: "Your business",
      fields: [
        { id: "businessName", label: "Business or idea name", type: "text", required: true },
        {
          id: "stage",
          label: "Current stage",
          type: "radio",
          required: true,
          options: ["Idea only", "Planning", "Operating under 1 year", "Operating 1+ years"],
        },
        { id: "businessIdea", label: "Describe your business idea", type: "textarea", rows: 6, required: true, hint: "What problem does it solve and who is it for?" },
        { id: "fundingNeeded", label: "Approximate funding needed (BBD)", type: "number" },
      ],
    },
  ],

  pathways: [
    { title: "About you", fields: DEFAULT_PERSONAL },
    {
      title: "Your situation",
      fields: [
        {
          id: "employment",
          label: "Current employment status",
          type: "radio",
          required: true,
          options: ["Unemployed", "Looking for work", "Working part-time", "In education"],
        },
        { id: "studying", label: "Are you in full-time education?", type: "radio", required: true, options: ["Yes", "No"], hint: "Pathways supports those not in full-time study." },
        { id: "interests", label: "What kind of work are you interested in?", type: "textarea", rows: 4, required: true },
      ],
    },
  ],

  cmc: [
    { title: "About you", fields: DEFAULT_PERSONAL },
    {
      title: "Your community",
      fields: [
        { id: "community", label: "Which community would you like to serve?", type: "text", required: true, hint: "The neighbourhood or area you know best." },
        { id: "skills", label: "Skills and experience you bring", type: "textarea", rows: 5, required: true, hint: "e.g. event planning, finance, youth work, construction." },
        { id: "motivation", label: "Why do you want to volunteer?", type: "textarea", rows: 5, required: true },
      ],
    },
  ],

  ceep: [
    { title: "About you", fields: DEFAULT_PERSONAL },
    {
      title: "Topic",
      fields: [
        {
          id: "topics",
          label: "Which topics are you interested in?",
          type: "checkbox-group",
          required: true,
          options: ["Tax matters", "NIS / Social security", "TAMIS registration", "Digital banking", "Financial services"],
        },
        {
          id: "session",
          label: "Preferred session location",
          type: "radio",
          options: ["Mount Tabor Moravian Church", "Black Bess Resource Centre", "Bayville Community Centre", "No preference"],
        },
      ],
    },
  ],

  "national-summer-camp": [
    {
      title: "About the parent / guardian",
      fields: [
        { id: "parentName", label: "Your full name", type: "text", required: true },
        { id: "parentEmail", label: "Email", type: "email", required: true },
        { id: "parentPhone", label: "Phone", type: "tel", required: true },
        { id: "relationship", label: "Relationship to child", type: "text", required: true },
      ],
    },
    {
      title: "About the child",
      fields: [
        { id: "childName", label: "Child's full name", type: "text", required: true },
        { id: "childDob", label: "Child's date of birth", type: "date", required: true },
        { id: "allergies", label: "Allergies or medical needs", type: "textarea", rows: 3, hint: "Leave blank if none." },
        { id: "preferredLocation", label: "Preferred camp location", type: "text", hint: "Camp runs at 46 locations island-wide." },
      ],
    },
  ],
};

// Public API
window.OPP_SCHEMAS = SCHEMAS;
window.OPP_DEFAULT_SCHEMA = DEFAULT_PAGES;
window.getSchema = (id) => SCHEMAS[id] || DEFAULT_PAGES;
