export const MAIN_CATEGORIES = [
  "Agriculture", "Anthropology", "Archaeology", "Architecture", "Art", "Art History", "Astrology", "Astronomy", "Aviation", 
  "Biology", "Business", "Business Management", "Chemistry", "Cognitive Psychology", "Communication", "Communication Technology", 
  "Computer Science", "Culinary Art", "Cultural Studies", "Design", "Earth Science", "Ecology", "Economics", "Education", 
  "Engineering", "Entertainment", "Environmental Science", "Environmental Studies", "Epistemology", "Ethics", "Fashion", "Film", 
  "Film Studies", "Food Science", "Food Studies", "Geography", "Geology", "Health", "Healthcare", "History", "Information Science", 
  "Insurance", "Journalism", "Law", "Leadership", "Library Science", "Linguistics", "Literature", "Management", "Marine Biology", 
  "Marine Science", "Maritime Studies", "Marketing", "Materials Science", "Mathematics", "Media", "Media Studies", "Medicine", 
  "Meteorology", "Microbiology", "Military Studies", "Museum Studies", "Music", "Neuroscience", "Ornithology", "Performing Art", 
  "Philosophy", "Physics", "Political Science", "Primatology", "Psycholinguistics", "Psychology", "Public Health", "Religion", 
  "Risk Management", "Science", "Scientific Method", "Social Science", "Sociology", "Sports", "Sports Psychology", "Sports Science", 
  "Statistics", "Technical Communication", "Technology", "Tourism", "Transportation", "Urban Planning", "Urban Studies", "Veterinary Science"
] as const;

export type MainCategory = typeof MAIN_CATEGORIES[number];

// Subcategories tailored for Korean middle/high school English reading passages (CSAT/TOEFL style)
export const SUB_CATEGORIES: Record<MainCategory, string[]> = {
  "Agriculture": [
    "Sustainable farming practices", "History of agriculture", "Organic farming vs. conventional", 
    "Genetically modified organisms (GMOs)", "The Green Revolution", "Urban farming and vertical gardens",
    "Impact of climate change on crops", "Irrigation techniques throughout history", "The role of bees in pollination",
    "Future of automated farming", "Soil conservation methods", "Crop rotation benefits", "Hydroponics and aquaponics",
    "Livestock management", "Evolution of pest control methods", "Food security issues", "Agricultural economics",
    "Traditional vs. modern tools", "Water scarcity in farming", "Biodiversity in agriculture"
  ],
  "Anthropology": [
    "Human evolution and origins", "Cultural relativism", "Language and culture connection", "Ancient civilizations of the Andes",
    "Hunter-gatherer societies", "Rituals and ceremonies", "Kinship systems", "The role of myths and legends",
    "Forensic anthropology applications", "Impact of globalization on culture", "Ethnography methods", "Human adaptation to environments",
    "Social structures in tribes", "Evolution of tools", "Migration patterns of early humans", "Digital anthropology",
    "Food culture across societies", "Nomadic lifestyles", "Urban anthropology", "Symbolism in human culture"
  ],
  "Archaeology": [
    "The discovery of Pompeii", "Carbon dating techniques", "The Rosetta Stone", "Excavation methods",
    "Understanding hieroglyphics", "The Terracotta Army", "Shipwreck archaeology", "Preserving cultural heritage sites",
    "Tools of ancient builders", "Interpreting pottery shards", "The mystery of Stonehenge", "Ancient trade routes",
    "LIDAR technology in archaeology", "Daily life in ancient Rome", "The significance of burial sites", "Lost cities of the Amazon",
    "Ethics of excavation", "Industrial archaeology", "Reconstructing ancient diets", "Underwater discoveries"
  ],
  "Architecture": [
    "Gothic cathedral design", "Modernist architecture movement", "Sustainable building materials", "History of skyscrapers",
    "The function of arches and domes", "Frank Lloyd Wright's influence", "Urban design principles", "Smart homes of the future",
    "Ancient Greek temples", "Bauhaus design philosophy", "The impact of light in space", "Tiny house movement",
    "Renovating historic buildings", "Landscape architecture", "Biophilic design", "3D printing in construction",
    "Acoustics in concert halls", "Minimalist architecture", "Renaissance architecture", "Bridge engineering"
  ],
  "Art": [
    "Impressionism and light", "Abstract expressionism", "The golden ratio in art", "Renaissance masters",
    "Color theory basics", "Modern art installations", "Surrealism and dreams", "The role of art in society",
    "Street art and graffiti", "Digital art evolution", "Restoration of masterpieces", "Art as therapy",
    "Pop art movement", "Sculpture materials and techniques", "Photography as fine art", "Symbolism in paintings",
    "Indigenous art forms", "Minimalism in visual art", "The art market economy", "Public art projects"
  ],
  "Art History": [
    "Cave paintings of Lascaux", "Byzantine mosaic art", "The Medici family patronage", "Women in art history",
    "The influence of Japanese prints", "Art during the French Revolution", "The shift from realism to modernism",
    "Islamic geometric patterns", "Pre-Columbian art", "The Dada movement", "Gothic art characteristics",
    "Baroque emotional intensity", "Neoclassicism vs. Romanticism", "African art influence on Picasso", "Art in the Industrial Age",
    "History of museums", "Iconography in religious art", "The changing role of the artist", "Art theft and recovery", "Post-war contemporary art"
  ],
  "Astrology": [
    "History of zodiac signs", "Astronomy vs. Astrology", "Cultural variations of horoscopes", "The Barnum effect",
    "Planetary alignments in myth", "Psychology of belief", "Ancient Babylonian astrology", "Chinese zodiac animals",
    "Astrology in literature", "The moon's influence in folklore", "Scientific criticism of astrology", "Interpretation of star charts",
    "Constellation myths", "Seasonal archetypes", "Cold reading techniques", "Historical figures and astrology",
    "Popularity of astrology today", "Symbolism of planets", "Elements in astrology", "Prediction vs. free will"
  ],
  "Astronomy": [
    "Life cycle of stars", "Black holes and event horizons", "The search for extraterrestrial life", "Mars colonization challenges",
    "The Big Bang theory", "Dark matter and dark energy", "Exoplanet discovery methods", " The history of telescopes",
    "Formation of the solar system", "Comets and asteroids", "The Hubble and James Webb telescopes", "Space debris problems",
    "Gravitational waves", "The phases of the moon", "Solar flares and space weather", "Nebulae: Stellar nurseries",
    "Interstellar travel concepts", "The concept of light years", "Galactic collisions", "Future of space exploration"
  ],
  "Aviation": [
    "The Wright brothers' legacy", "How airplanes fly (Aerodynamics)", "History of commercial flight", "Jet engine technology",
    "Air traffic control systems", "Evolution of drone technology", "Supersonic flight", "Amelia Earhart's journey",
    "Safety innovations in aviation", "The role of pilots vs. autopilot", "Spaceplanes and reusable rockets", "Helicopter mechanics",
    "Air cargo logistics", "Environmental impact of flying", "Future of electric aircraft", "Gliders and human flight",
    "Airport infrastructure", "Military aviation history", "Turbulence and weather", "The training of astronauts"
  ],
  "Biology": [
    "Structure of DNA", "Photosynthesis process", "Theory of natural selection", "Cellular respiration",
    "The human immune system", "Biodiversity hotspots", "CRISPR and gene editing", "Symbiotic relationships",
    "Microbiome and health", "Animal migration patterns", "Stem cell research", "Enzymes and catalysts",
    "Invasive species impact", "Bioluminescence in nature", "The circulatory system", "Mitosis and meiosis",
    "Viruses vs. bacteria", "Evolutionary adaptations", "Cloning technology", "Biological clocks (Circadian rhythm)"
  ],
  "Business": [
    "Supply and demand basics", "Entrepreneurship challenges", "Corporate social responsibility", "Types of business ownership",
    "Marketing strategies", "Global trade and tariffs", "The gig economy", "E-commerce evolution",
    "Business ethics", "Remote work trends", "Start-up funding stages", "Franchising models",
    "Consumer behavior analysis", "Inventory management", "Negotiation skills", "Brand loyalty",
    "Outsourcing pros and cons", "The role of human resources", "Financial literacy for business", "Market research methods"
  ],
  "Business Management": [
    "Leadership styles", "Conflict resolution in teams", "Change management", "Strategic planning",
    "Organizational culture", "Performance appraisal systems", "Time management techniques", "Decision making processes",
    "Employee motivation theories", "Operations management", "Crisis management", "Project management basics",
    "Lean manufacturing", "Diversity in the workplace", "Communication channels", "Risk assessment",
    "Supply chain logistics", "Business innovation", "Corporate governance", "Mentorship programs"
  ],
  "Chemistry": [
    "The Periodic Table history", "Chemical bonds: Ionic vs Covalent", "Acids and bases in daily life", "States of matter",
    "Chemical reactions and catalysts", "Polymers and plastics", "The chemistry of cooking", "Green chemistry principles",
    "Radioactive decay", "Nanotechnology applications", "Forensic chemistry", "Biochemistry basics",
    "Water properties", "Atmospheric chemistry", "Pharmaceutical drug development", "Fossil fuels and combustion",
    "Corrosion and rust", "Laboratory safety", "Isotopes and their uses", "The mole concept"
  ],
  "Cognitive Psychology": [
    "Memory formation steps", "Short-term vs long-term memory", "Cognitive dissonance", "Decision making biases",
    "Attention span theories", "Problem-solving strategies", "Language acquisition in children", "The nature of intelligence",
    "Perception and optical illusions", "Neuroplasticity", "The unconscious mind", "Emotional intelligence",
    "Information processing model", "False memory syndrome", "Creativity and the brain", "Metacognition",
    "Aging and cognitive decline", "Learning styles debate", "Artificial intelligence vs human cognition", "Sleep and reading"
  ],
  "Communication": [
    "Non-verbal communication", "Active listening skills", "Barriers to effective communication", "Intercultural communication",
    "Public speaking anxiety", "History of writing systems", "Mass media influence", "The art of persuasion",
    "Digital communication etiquette", "Conflict resolution dialogue", "Propaganda techniques", "Semiotics basics",
    "Corporate communication", "Interpersonal relationships", "Storytelling impact", "Feedback loops",
    "Fake news and information literacy", "Social media dynamics", "Evolution of language", "Debate techniques"
  ],
  "Communication Technology": [
    "Internet of Things (IoT)", "5G technology impact", "History of the telephone", "Fiber optics",
    "Satellite communication", "Blockchain basics", "Cybersecurity threats", "Cloud computing",
    "Virtual Reality (VR) in communication", "The evolution of email", "Social networking algorithms", "Big data analytics",
    "Encryption methods", "Wearable technology", "Streaming services", "Quantum computing potential",
    "The digital divide", "Video conferencing tech", "Artificial Intelligence in chat", "Mobile app development"
  ],
  "Computer Science": [
    "Algorithms and complexity", "Binary code basics", "Machine learning concepts", "Operating systems functions",
    "Open source software", "Data structures (Arrays, Linked Lists)", "Object-oriented programming", "History of the internet",
    "Computer graphics", "Database management", "Ethical hacking", "Robotics software",
    "Sorting algorithms", "Network protocols (HTTP, TCP/IP)", "Turing test", "Software engineering lifecycle",
    "Human-computer interaction", "Cryptography", "Cloud architecture", "Programming languages evolution"
  ],
  "Culinary Art": [
    "The science of baking", "History of fermentation", "Molecular gastronomy", "Global spice trade history",
    "Farm-to-table movement", "Knife skills and safety", "The five basic tastes", "Food plating aesthetics",
    "Regional cuisines of Italy", "Traditional Korean fermentation", "French cooking techniques", "Sustainable seafood",
    "Chocolate making process", "Coffee culture and history", "The role of a sous chef", "Food preservation methods",
    "Vegan cooking innovations", "Fusion cuisine", "Street food culture", "Michelin star system"
  ],
  "Cultural Studies": [
    "Pop culture trends", "Globalization vs. localization", "Subcultures and identity", "Cultural appropriation debate",
    "Post-colonial literature", "Gender roles across cultures", "The concept of 'The Other'", "Folk traditions",
    "Festivals and celebrations", "Cultural heritage preservation", "Language death", "Digital culture",
    "Youth culture evolution", "Food as cultural identity", "Fashion and culture", "Race and ethnicity",
    "Symbolism in rituals", "Collectivism vs individualism", "Media representation", "Cultural diffusion"
  ],
  "Design": [
    "Principles of graphic design", "User experience (UX) design", "Industrial design history", "Typography basics",
    "Color psychology in branding", "Sustainable product design", "Fashion design cycle", "Interior design theories",
    "Design thinking process", "Minimalism vs Maximalism", "Logo design evolution", "Ergonomics in design",
    "Wayfinding systems", "Web design accessibility", "Package design trends", "Design for social good",
    "History of chairs", "Automotive design", "Biomimicry in design", "Universal design"
  ],
  "Earth Science": [
    "Plate tectonics", "The water cycle", "Rock cycle stages", "Cause of earthquakes",
    "Volcanic eruptions types", "Layers of the atmosphere", "Ocean currents", "Climate change evidence",
    "Soil erosion", "Glacier formation", "Weather forecasting methods", "Renewable energy sources",
    "Fossil formation", "Minerals and gems", "The greenhouse effect", "Tsunami mechanics",
    "Deserts and desertification", "Cave systems", "Meteorology basics", "Carbon cycle"
  ],
  "Ecology": [
    "Food chains and webs", "Keystone species", "Ecosystem services", "Population dynamics",
    "Biomes of the world", "Deforestation impact", "Coral reef bleaching", "Succession in nature",
    "Carbon footprint", "Biodiversity loss", "Wetland conservation", "Urban ecology",
    "Symbiosis examples", "Pollution types", "Conservation biology", "Restoration ecology",
    "Adaptation vs Acclimatization", "Niche and habitat", "Energy flow in ecosystems", "Plastic pollution"
  ],
  "Economics": [
    "Microeconomics vs Macroeconomics", "Law of diminishing returns", "Inflation and deflation", "Gross Domestic Product (GDP)",
    "Market structures (Monopoly, Oligopoly)", "Fiscal vs Monetary policy", "International trade", "Behavioral economics",
    "Opportunity cost", "Labor market trends", "The stock market basics", "Cryptocurrency",
    "Developing economies", "Income inequality", "Economic bubbles", "Game theory",
    "Taxes and subsidies", "Consumer price index", "Global financial crisis", "Sustainable economics"
  ],
  "Education": [
    "Montessori method", "Standardized testing debate", "Flipped classroom model", "Online learning trends",
    "Special education needs", "Early childhood development", "Bilingual education", "Critical thinking skills",
    "Teacher training", "History of public schools", "Gamification in education", "Assessment methods",
    "Literacy rates", "Higher education costs", "Homeschooling pros/cons", "Lifelong learning",
    "STEM education", "Education disparity", "Peer learning", "Feedback in learning"
  ],
  "Engineering": [
    "Civil engineering feats", "Mechanical engineering basics", "Electrical circuits", "Software engineering",
    "Chemical engineering processes", "Aerospace innovations", "Biomedical engineering", "Structural integrity",
    "Robotics automation", "Sustainable engineering", "History of bridges", "The steam engine",
    "Nanotechnology in engineering", "Autonomous vehicles", "Renewable energy grids", "Hydraulic systems",
    "Materials engineering", "Safety in engineering", "Engineering ethics", "Reverse engineering"
  ],
  "Entertainment": [
    "History of cinema", "Evolution of video games", "The music industry", "Streaming wars",
    "Reality TV impact", "Social media influencers", "Theme park design", "Theater production",
    "Stand-up comedy evolution", "CGI special effects", "E-sports growth", "Celebrity culture",
    "The publishing industry", "Radio and podcasts", "Magic and illusion", "Film genres",
    "Audience psychology", "Content creation", "Live events industry", "Animation history"
  ],
  "Environmental Science": [
    "Global warming mechanics", "Acid rain causes", "Ozone layer depletion", "Waste management",
    "Renewable energy tech", "Water pollution solutions", "Air quality index", "Endangered species",
    "Sustainable living", "Environmental policy", "Ocean acidification", "Alternative fuels",
    "Nuclear energy debate", "Conservation strategies", "Ecological footprint", "Overfishing",
    "Deforestation effects", "Soil contamination", "Green building", "Environmental ethics"
  ],
  "Environmental Studies": [
    "Environmental justice", "Policy and regulation", "Human-nature relationship", "Sustainability movements",
    "Eco-tourism", "Corporate sustainability", "Environmental history", "Climate migration",
    "Urban sustainability", "Indigenous knowledge", "Environmental activism", "Philosophy of nature",
    "Resource management", "Population growth impact", "Circular economy", "Green politics",
    "Global agreements (Paris Accord)", "Environmental law", "Land use planning", "Ethics of consumption"
  ],
  "Epistemology": [
    "Theory of knowledge", "Empiricism vs Rationalism", "Skepticism", "The nature of truth",
    "Belief and justification", "Sources of knowledge", "Intuition vs Reason", "Scientific paradigm shifts",
    "Testimonial knowledge", "Constructivism", "Perception and reality", "The problem of induction",
    "Limits of human knowledge", "Epistemic injustice", "Logic and reasoning", "Objectivity vs Subjectivity",
    "Memory validation", "Gettier problem", "Certainty and doubt", "Wisdom vs Knowledge"
  ],
  "Ethics": [
    "Utilitarianism", "Deontology (Duty-based)", "Virtue ethics", "Bioethics cases",
    "Environmental ethics", "Business ethics dilemmas", "AI ethics", "Animal rights",
    "Euthanasia debate", "Capital punishment", "Privacy rights", "Genetic engineering ethics",
    "Freedom of speech", "Moral relativism", "Altruism", "Just war theory",
    "Professional codes of conduct", "Ethics of care", "Truth telling", "Equality and justice"
  ],
  "Fashion": [
    "History of haute couture", "Fast fashion impact", "Sustainable fashion", "Textile technology",
    "Fashion marketing", "Iconic designers", "Streetwear evolution", "Gender in fashion",
    "Fashion cycles", "Costume design", "Psychology of clothing", "Ethical sourcing",
    "Digital fashion", "Cultural dress", "Accessory design", "Fashion journalism",
    "Trend forecasting", "Upcycling clothes", "Luxury brand management", "Fashion week history"
  ],
  "Film": [
    "Film noir genre", "The auteur theory", "Cinematography techniques", "Documentary filmmaking",
    "Screenwriting structure", "Film editing evolution", "Sound design in movies", "Animation styles",
    "Foreign language films", "The Oscars history", "Independent cinema", "Film censorship",
    "Special effects (VFX)", "Acting methods", "Movie marketing", "Film distribution",
    "Silent film era", "Technicolor revolution", "Blockbuster formula", "Film criticism"
  ],
  "Film Studies": [
    "Feminist film theory", "Gaze theory", "Semiotic analysis of film", "Genre deconstruction",
    "Representation in media", "Cinema and ideology", "National cinema movements", "Psychoanalysis in film",
    "Narrative structure", "Audience reception", "Cult classic phenomenon", "Film preservation",
    "Adaptation (Book to Movie)", "Third cinema", "Post-modern film", "Visual storytelling",
    "Propaganda films", "Experimental cinema", "Ethics of documentary", "The star system"
  ],
  "Food Science": [
    "Nutritional composition", "Food preservation chemistry", "Flavor profiles", "Food safety regulations",
    "Additives and preservatives", "Fermentation science", "Sensory evaluation", "Food packaging tech",
    "Alternative proteins", "Genetically modified food", "Food allergies", "Digestion process",
    "Vitamins and minerals", "Foodborne illnesses", "Product development", "Shelf life testing",
    "The chemistry of baking", "Dairy science", "Meat processing", "Functional foods"
  ],
  "Food Studies": [
    "Food history", "Sociology of food", "Food politics", "Global food systems",
    "Gastronomy", "Food and identity", "Ethical eating", "Slow food movement",
    "Food deserts", "Culinary tourism", "Rituals of eating", "Food waste issues",
    "Cookbooks as literature", "Restaurant culture", "Food marketing", "Diet culture critic",
    "Community gardens", "Food sovereignty", "Comparison of diets", "Feasts and famines"
  ],
  "Geography": [
    "Physical geography", "Human geography", "Cartography (Map making)", "GIS technology",
    "Urbanization patterns", "Population density", "Migration trends", "Geopolitics",
    "Climate zones", "Landforms and topography", "Natural resources distribution", "Cultural landscapes",
    "Economic geography", "Remote sensing", "Political borders", "Tourism geography",
    "Natural disasters", "Regional studies", "Water resources", "Globalization effects"
  ],
  "Geology": [
    "Continental drift", "Rock types (Igneous, Sedimentary, Metamorphic)", "Fossil dating", "Earthquake zones",
    "Volcano types", "Mineral identification", "Groundwater geology", "Plate boundaries",
    "Geological time scale", "Mining methods", "Soil formation", "Glacial geology",
    "Erosion and weathering", "Petroleum geology", "Gemology", "Geothermal energy",
    "Caves and Karst", "Paleontology connection", "Planetary geology", "Field mapping"
  ],
  "Health": [
    "Nutrition basics", "Exercise physiology", "Mental health awareness", "Sleep hygiene",
    "Stress management", "Preventative medicine", "First aid basics", "Substance abuse",
    "Healthy aging", "Alternative medicine", "Global health issues", "Pandemic history",
    "Personal hygiene", "Occupational health", "Reproductive health", "Immunization",
    "Chronic disease management", "Wellness trends", "Hydration importance", "Ergonomics"
  ],
  "Healthcare": [
    "Healthcare systems (Public vs Private)", "Doctor-patient relationship", "Medical ethics", "Hospital management",
    "Telemedicine", "Health insurance", "Nursing roles", "Patient rights",
    "Emergency response", "Medical technology", "Pharmaceutical industry", "Healthcare accessibility",
    "Mental health services", "Palliative care", "Public health policy", "Electronic health records",
    "Medical research ethics", "Global health organizations", "Surgery advancements", "Healthcare inequality"
  ],
  "History": [
    "The fall of Rome", "The Renaissance", "Industrial Revolution", "World War I & II",
    "Cold War politics", "Civil Rights Movement", "Feudalism in Europe", "The Silk Road",
    "Colonialism and decolonization", "French Revolution", "American Civil War", "Ancient Egypt",
    "Dynasties of China", "Viking expansion", "The Great Depression", "Apartheid in South Africa",
    "History of Democracy", "The Space Race", "Women's suffrage", "Digital revolution"
  ],
  "Information Science": [
    "Data organization", "Information retrieval", "Digital libraries", "Knowledge management",
    "Information architecture", "User behavior analysis", "Archival science", "Database design",
    "Metadata standards", "Information ethics", "Search engine capability", "Data mining",
    "Information security", "Big data", "Human-information interaction", "Digital preservation",
    "Copyright in digital age", "Social informatics", "Algorithm bias", "Cloud storage"
  ],
  "Insurance": [
    "Principles of insurance", "Risk assessment", "Life insurance types", "Health insurance models",
    "Property and casualty", "Actuarial science basics", "Insurance fraud", "Underwriting process",
    "Reinsurance", "Liability coverage", "Auto insurance factors", "Claims handling",
    "Micro-insurance", "Cyber insurance", "History of insurance", "Social insurance",
    "Insurtech", "Disaster coverage", "Annuities", "Regulatory compliance"
  ],
  "Journalism": [
    "Press freedom", "Investigative journalism", "News writing style", "Ethics in journalism",
    "Photojournalism", "Broadcast journalism", "Digital news trends", "Citizen journalism",
    "Censorship issues", "Interview techniques", "Fact-checking", "History of newspapers",
    "Editorial vs Reporting", "Media bias", "War correspondence", "Data journalism",
    "The role of the editor", "Sensationalism", "Future of news", "Local news decline"
  ],
  "Law": [
    "Constitutional law", "Criminal justice system", "Contracts and torts", "International law",
    "Human rights law", "Intellectual property", "Corporate law", "Family law",
    "Environmental law", "Legal ethics", "Trial procedures", "Common law vs Civil law",
    "Cyber law", "Labor rights", "Immigration law", "Legal precedent",
    "The role of judges", "Jury system", "Mediation and arbitration", "Access to justice"
  ],
  "Leadership": [
    "Transformational leadership", "Servant leadership", "Decision making", "Team building",
    "Emotional intelligence in leaders", "Conflict resolution", "Vision and strategy", "Crisis leadership",
    "Ethical leadership", "Women in leadership", "Charismatic leadership", "Situational leadership",
    "Mentorship", "Power and influence", "Organizational change", "Communication skills",
    "Leadership vs Management", "Cross-cultural leadership", "Innovation leadership", "Developing potential"
  ],
  "Library Science": [
    "Cataloging systems (Dewey/LC)", "Digital archiving", "Information literacy", "Collection development",
    "Library history", "Preservation of books", "Public library services", "Academic libraries",
    "Reference services", "Library management", "Open access", "Community outreach",
    "Rare book collections", "Technology in libraries", "Intellectual freedom", "Reader's advisory",
    "Data management", "Bibliometrics", "School libraries", "Future of libraries"
  ],
  "Linguistics": [
    "Phonetics and phonology", "Syntax and grammar", "Semantics (Meaning)", "Language acquisition",
    "Sociolinguistics", "Historical linguistics", "Psycholinguistics", "Language families",
    "Dialects and accents", "Pragmatics", "Computational linguistics", "Writing systems",
    "Language extinction", "Bilingualism", "Translation theory", "Forensic linguistics",
    "Sign languages", "Language evolution", "Discourse analysis", "Universal grammar"
  ],
  "Literature": [
    "Shakespearean drama", "Romantic poetry", "The Victorian novel", "Modernist literature",
    "Post-colonial literature", "American transcendentalism", "Greek mythology", "Dystopian fiction",
    "Literary criticism", "Haiku and poetry forms", "The epic hero journey", "Gothic literature",
    "Realism vs Naturalism", "Existentialist literature", "Folklore and fairy tales", "Graphic novels",
    "Literature of the Harlem Renaissance", "Magical realism", "Nobel prize authors", "Symbolism in literature"
  ],
  "Management": [
    "Strategic management", "Human resource management", "Organizational behavior", "Operations management",
    "Marketing management", "Financial management", "Innovation management", "Supply chain management",
    "Project management", "Quality control", "Risk management", "Change management",
    "International business", "Corporate culture", "Start-up management", "Non-profit management",
    "Leadership theories", "Negotiation tactics", "Time management", "Performance metrics"
  ],
  "Marine Biology": [
    "Coral reef ecosystems", "Deep sea creatures", "Marine mammals", "Ocean acidification",
    "Plankton and food webs", "Sharks and predators", "Bioluminescence", "Marine conservation",
    "Intertidal zones", "Migration of whales", "Symbiosis in the ocean", "Seaweed and algae",
    "Marine pollution", "Overfishing impacts", "Hydrothermal vents", "Aquaculture",
    "Marine biodiversity", "Adaptations to pressure", "Ocean currents and life", "Future of oceans"
  ],
  "Marine Science": [
    "Oceanography", "Tides and waves", "Seafloor mapping", "Marine chemistry",
    "Atmosphere-ocean interaction", "Climate change impact", "Marine geology", "Coastal erosion",
    "Satellite oceanography", "Marine tech (ROVs)", "Desalination", "El Niño phenomena",
    "Marine resources", "Polar oceanography", "Sedimentology", "Underwater acoustics",
    "Marine policy", "Blue economy", "Ocean energy", "Navigation history"
  ],
  "Maritime Studies": [
    "Maritime history", "Shipping industry", "Port management", "Law of the sea",
    "Naval architecture", "Piracy history", "Maritime security", "International trade routes",
    "Shipwrecks", "Maritime culture", "Logistics", "Marine insurance",
    "Seafarer rights", "Autonomous ships", "Environmental regulations", "Cruise industry",
    "Containerization", "Lighthouse history", "Naval strategy", "Coastal communities"
  ],
  "Marketing": [
    "Digital marketing", "Consumer behavior", "Brand management", "Social media strategies",
    "Market segmentation", "Advertising ethics", "Product lifecycle", "Content marketing",
    "Viral marketing", "SEO basics", "Influencer marketing", "Neuromarketing",
    "Public relations", "B2B vs B2C", "Marketing analytics", "Email marketing",
    "Experiential marketing", "Green marketing", "Global marketing", "Crisis communication"
  ],
  "Materials Science": [
    "Nanomaterials", "Semiconductors", "Polymers", "Ceramics and glass",
    "Metallurgy", "Composite materials", "Biomaterials", "Smart materials",
    "Material strength", "Corrosion prevention", "Recycling technology", "Superconductors",
    "3D printing materials", "Textile science", "Graphene", "Solar cell materials",
    "Material testing", "History of materials", "Failure analysis", "Sustainable materials"
  ],
  "Mathematics": [
    "Algebra basics", "Geometry principles", "Calculus concepts", "Probability theory",
    "Statistics applications", "Number theory", "Topology", "Fractals and chaos",
    "History of zero", "The golden ratio", "Cryptography math", "Graph theory",
    "Linear algebra", "Logic and sets", "Game theory", "Mathematical modeling",
    "Famous unsolved problems", "Math in nature", "Financial math", "Infinity concepts"
  ],
  "Media": [
    "Mass media evolution", "Social media impact", "News ownership", "Media literacy",
    "Broadcasting history", "Digital capabilities", "Advertising trends", "Public opinion",
    "Media regulation", "Global media", "Streaming platforms", "Journalism ethics",
    "Representation in media", "Media convergence", "Audience analysis", "Propaganda",
    "Citizen journalism", "Virtual reality", "Podcast growth", "Fake news"
  ],
  "Media Studies": [
    "Media theory", "Cultural imperialism", "Feminist media studies", "Semiotics of media",
    "Digital divide", "Media ecology", "Fan culture", "Celebrity studies",
    "Video game analysis", "Television studies", "Film theory", "New media art",
    "Surveillance culture", "Algorithm culture", "Political economy of media", "Globalization",
    "Visual culture", "Sound studies", "Media archaeology", "Post-humanism"
  ],
  "Medicine": [
    "History of medicine", "Anatomy and physiology", "Pharmacology", "Surgery evolution",
    "Medical ethics", "Pathology", "Immunology", "Neurology basics",
    "Cardiology", "Oncology (Cancer)", "Pediatrics", "Geriatrics",
    "Medical imaging (MRI/X-ray)", "Genetics in medicine", "Emergency medicine", "Global diseases",
    "Psychiatry", "Traditional medicine", "Robotic surgery", "Personalized medicine"
  ],
  "Meteorology": [
    "Weather forecasting", "Cloud types", "Tornado formation", "Hurricane dynamics",
    "Climate vs Weather", "The water cycle", "Atmospheric pressure", "Wind patterns",
    "Precipitation types", "Thunderstorms", "Global warming", "El Niño/La Niña",
    "Remote sensing", "Weather satellites", "Extreme weather events", "Air quality",
    "Microclimates", "Meteorological instruments", "Jet streams", "Monsoons"
  ],
  "Microbiology": [
    "Bacteria types", "Viruses structure", "Fungi and mold", "Antibiotic resistance",
    "Microscope history", "Cell culturing", "Pathogens", "Immunology basics",
    "Gut microbiome", "Vaccine development", "Fermentation", "Industrial microbiology",
    "Environmental microbiology", "Parasitology", "Virology", "Bacteriology",
    "Probiotics", "Germ theory", "Biofilms", "Extremophiles"
  ],
  "Military Studies": [
    "History of warfare", "Strategy and tactics", "Military technology", "Leadership in combat",
    "International conflict", "Peacekeeping missions", "Cyber warfare", "Naval history",
    "Air force evolution", "Military ethics", "Logistics of war", "Special forces",
    "Intelligence gathering", "Nuclear deterrence", "PTSD in veterans", "Women in military",
    "Drone warfare", "Guerilla warfare", "Military law", "Sun Tzu's Art of War"
  ],
  "Museum Studies": [
    "Curatorial practices", "Conservation of artifacts", "Museum education", "Exhibition design",
    "Repatriation of art", "Digital museums", "Visitor experience", "Museum history",
    "Natural history museums", "Art galleries", "Science centers", "Archival methods",
    "Funding and grants", "Museum ethics", "Community engagement", "Interactive exhibits",
    "Providence research", "Cultural heritage", "Museum management", "Virtual tours"
  ],
  "Music": [
    "Classical music eras", "Jazz history", "Rock and roll evolution", "Music theory basics",
    "Instruments of the orchestra", "Electronic music", "World music genres", "Psychology of music",
    "Music therapy", "Songwriting structure", "Opera history", "Hip hop culture",
    "Music production", "Copyright in music", "The biology of hearing", "Musical notation",
    "Impact of streaming", "Women composers", "Film scores", "Music education"
  ],
  "Neuroscience": [
    "Brain anatomy", "Neurons and synapses", "Neurotransmitters", "Brain plasticity",
    "Memory mechanisms", "Sleep and the brain", "Neurodegenerative diseases", "Consciousness",
    "The teenage brain", "Emotion and the brain", "Sensation and perception", "Brain imaging (fMRI)",
    "Mirror neurons", "Language processing", "Addiction pathways", "Neuroethics",
    "Artificial neural networks", "Brain-computer interfaces", "Learning processes", "Split-brain research"
  ],
  "Ornithology": [
    "Bird migration", "Feather structure", "Bird song and calls", "Evolution of birds",
    "Bird watching", "Conservation of birds", "Raptors/Birds of prey", "Nesting habits",
    "Flight mechanics", "Waterfowl", "Parrots and intelligence", "Penguin adaptations",
    "Urban birds", "Extinct birds", "Hummingbird metabolism", "Owl adaptations",
    "Seabirds", "Bird photography", "Backyard birding", "Climate change impact"
  ],
  "Performing Art": [
    "Theater history", "Acting techniques", "Dance genres", "Opera",
    "Musical theater", "Stage design", "Puppetry", "Improvisation",
    "Circus arts", "Performance art", "Directing concepts", "Choreography",
    "Costume design", "Lighting and sound", "Audience interaction", "Street performance",
    "Mime and pantomime", "Traditional dance", "Voice projection", "The audition process"
  ],
  "Philosophy": [
    "Socrates and Plato", "Aristotle's logic", "Stoicism", "Existentialism",
    "Utilitarianism", "Nihilism", "Ethics vs Morality", "Free will debate",
    "Mind-body problem", "Eastern philosophy", "Philosophy of science", "Political philosophy",
    "Aesthetics", "Metaphysics", "Epistemology", "Logic paradoxes",
    "Feminist philosophy", "Philosophy of language", "Phenomenology", "Modern philosophers"
  ],
  "Physics": [
    "Newton's laws", "Relativity theory", "Quantum mechanics", "Thermodynamics",
    "Electricity and magnetism", "Light and optics", "Sound waves", "Nuclear physics",
    "Particle physics", "Astrophysics", "Fluid dynamics", "Gravity",
    "Energy conservation", "Force and motion", "Atomic structure", "String theory",
    "Chaos theory", "Semiconductors", "History of physics", "Physics in sports"
  ],
  "Political Science": [
    "Democracy types", "Authoritarianism", "International relations", "Political ideologies",
    "Electoral systems", "Public policy", "Human rights", "Political correctness",
    "Lobbying and interest groups", "The UN and NATO", "Comparative politics", "Political philosophy",
    "War and peace", "Globalization politics", "Media and politics", "Civil liberties",
    "Political economy", "Diplomacy", "Populism", "Environmental politics"
  ],
  "Primatology": [
    "Chimpanzee behavior", "Gorilla social structure", "Orangutans", "Jane Goodall's work",
    "Primate conservation", "Evolution of primates", "Tool use in monkeys", "Communication methods",
    "Lemurs of Madagascar", "Great apes vs monkeys", "Primate intelligence", "Diet and nutrition",
    "Habitat loss", "Captive breeding", "Emotional lives of apes", "Ethology",
    "Field research methods", "Sign language studies", "Aggression and reconciliation", "Comparison to humans"
  ],
  "Psycholinguistics": [
    "Language acquisition", "Bilingualism brain", "Speech production", "Language disorders (Aphasia)",
    "Reading processes", "Dyslexia", "Language and thought", "Sign language processing",
    "Sentence parsing", "Word recognition", "Memory for language", "Slips of the tongue",
    "Language development", "Brain areas for language", "Second language learning", "Gesture and speech",
    "Prosody and tone", "Semantic processing", "Language in aging", "Artificial intelligence NLP"
  ],
  "Psychology": [
    "Freud and psychoanalysis", "Behaviorism", "Cognitive psychology", "Developmental stages",
    "Abnormal psychology", "Social psychology experiments", "Personality theories", "Memory and learning",
    "Motivation", "Emotion theories", "Stress and coping", "Psychological disorders",
    "Therapy types", "Research methods", "Brain and behavior", "Sleep and dreams",
    "Attachment theory", "Intelligence testing", "Positive psychology", "Forensic psychology"
  ],
  "Public Health": [
    "Epidemiology", "Pandemic response", "Vaccination programs", "Health disparities",
    "Global health organizations", "Sanitation history", "Nutrition policy", "Mental health initiatives",
    "Health education", "Environmental health", "Maternal health", "Anti-smoking campaigns",
    "Obesity epidemic", "Access to care", "Biostatistics", "Health economics",
    "Infectious diseases", "Occupational safety", "Community health", "Healthcare policy"
  ],
  "Religion": [
    "Christianity history", "Islam beliefs", "Buddhism philosophy", "Hinduism gods",
    "Judaism traditions", "Sikhism", "Comparative religion", "Mythology",
    "Religious rituals", "Ethics in religion", "Theology", "Secularism",
    "Religion and science", "Mysticism", "Sacred texts", "Religious art",
    "Pilgrimage", "Religion in society", "Fundamentalism", "New age movements"
  ],
  "Risk Management": [
    "Identifying risks", "Risk assessment matrix", "Crisis communication", "Insurance principles",
    "Financial risk", "Cybersecurity risk", "Project risk", "Safety protocols",
    "Disaster recovery", "Compliance and regulations", "Decision making under uncertainty", "Operational risk",
    "Risk mitigation strategies", "Enterprise risk management", "Supply chain risk", "Reputational risk",
    "Health and safety", "Environmental risk", "Quantitative analysis", "Risk culture"
  ],
  "Science": [
    "Scientific method", "History of science", "Major discoveries", "Women in science",
    "Science ethics", "Pseudoscience", "Science communication", "Citizen science",
    "The Nobel Prize", "Future technologies", "Science education", "Funding for research",
    "Peer review process", "Science policy", "Interdisciplinary science", "Lab safety",
    "Measurement systems", "Observation vs Inference", "Hypothesis testing", "Science and religion"
  ],
  "Scientific Method": [
    "Hypothesis formulation", "Experimental design", "Data collection", "Control groups",
    "Variables (Independent/Dependent)", "Reproducibility", "Statistical significance", "Bias in research",
    "Theory vs Law", "Observation techniques", "Lab report writing", "Data analysis",
    "Qualitative vs Quantitative", "Ethics in research", "Peer review", "Falsifiability",
    "Double-blind studies", "Correlation vs Causation", "Publishing results", "Paradigm shifts"
  ],
  "Social Science": [
    "Sociology basics", "Anthropology overview", "Political science", "Economics",
    "Psychology introduction", "Social research methods", "Culture and society", "Social institutions",
    "Social inequality", "Demography", "Gender studies", "Race and ethnicity",
    "Social change", "Globalization", "Urban studies", "Criminology",
    "Education systems", "Family structures", "Religion in society", "Social movements"
  ],
  "Sociology": [
    "Socialization", "Social norms", "Deviance and crime", "Social stratification",
    "Race and ethnicity", "Gender roles", "Family dynamics", "Education systems",
    "Religion institute", "Urban sociology", "Social movements", "Bureaucracy",
    "Culture shock", "Mass media", "Globalization", "Research methods",
    "Social interaction", "Aging society", "Inequality", "Collective behavior"
  ],
  "Sports": [
    "Olympics history", "Psychology of winning", "Sports nutrition", "Team dynamics",
    "Women in sports", "Doping controversies", "Sports technology", "Training methods",
    "Sports injuries", "Professional leagues", "Sports marketing", "Fan culture",
    "E-sports", "Extreme sports", "Sports management", "Fair play ethics",
    "History of soccer", "Basketball evolution", "Paralympics", "Youth sports"
  ],
  "Sports Psychology": [
    "Motivation techniques", "Performance anxiety", "Goal setting", "Visualization",
    "Team cohesion", "Focus and concentration", "Confidence building", "Dealing with injury",
    "Burnout in athletes", "Coach-athlete relationship", "Mental toughness", "Routine and rituals",
    "Leadership in sports", "Aggression in sports", "Stress management", "Youth development",
    "Mindfulness for athletes", "Self-talk", "Group dynamics", "Exercise adherence"
  ],
  "Sports Science": [
    "Biomechanics", "Exercise physiology", "Sports nutrition", "Motor learning",
    "Kinesiology", "Strength and conditioning", "Injury prevention", "Performance analysis",
    "Sports technology", "Recovery methods", "Hydration strategies", "Talent identification",
    "Doping testing", "Equipment design", "Training periodization", "Cardiovascular health",
    "Muscle anatomy", "Energy systems", "Rehabilitation", "Data analytics in sports"
  ],
  "Statistics": [
    "Mean, median, mode", "Standard deviation", "Probability basics", "Normal distribution",
    "Hypothesis testing", "Correlation and regression", "Sampling methods", "Data visualization",
    "Bias in statistics", "P-values interpretation", "Survey design", "Bayesian statistics",
    "Big data", "Use in sports", "Medical statistics", "Census data",
    "Confidence intervals", "Outliers", "Experimental design", "Misleading graphs"
  ],
  "Technical Communication": [
    "Technical writing style", "User manuals", "Data visualization", "Proposal writing",
    "Documentation", "Editing and proofreading", "Audience analysis", "Instructional design",
    "Report writing", "Grant writing", "White papers", "Oral presentations",
    "Graphics and layout", "Collaborative writing", "Usability testing", "Ethics in communication",
    "Digital publishing", "Translation and localization", "Plain language", "Resume writing"
  ],
  "Technology": [
    "Artificial intelligence", "Robotics", "Internet evolution", "Smartphones impact",
    "Blockchain", "Virtual reality", "Cybersecurity", "Autonomous vehicles",
    "Nanotechnology", "Biotechnology", "Space tech", "Renewable energy tech",
    "Wearables", "3D printing", "Cloud computing", "The digital divide",
    "Tech giants", "Privacy concerns", "Future of work", "Automation"
  ],
  "Tourism": [
    "Sustainable tourism", "Eco-tourism", "Cultural heritage sites", "Hotel management",
    "Travel trends", "Impact of airlines", "Tourism marketing", "Destination management",
    "Dark tourism", "Backpacking culture", "Gastronomic tourism", "Event management",
    "Over-tourism issues", "Travel technology", "Hospitality industry", "Travel safety",
    "Cruise tourism", "Adventure travel", "Economic impact", "Tourism policy"
  ],
  "Transportation": [
    "Electric vehicles", "High-speed rail", "Autonomous driving", "Public transit systems",
    "Aviation history", "Maritime shipping", "Logistics", "Urban mobility",
    "Sustainable transport", "Bicycle infrastructure", "Hyperloop concepts", "Traffic management",
    "Supply chain", "Ride-sharing apps", "Infrastructure design", "Future of commute",
    "Drone delivery", "Canals and waterways", "Safety regulations", "Transport economics"
  ],
  "Urban Planning": [
    "Zoning laws", "Smart cities", "Public transportation", "Green spaces",
    "Housing policy", "Sustainable design", "Urban sprawl", "Gentrification",
    "Historical preservation", "Community development", "Traffic flow", "Pedestrian zones",
    "Waste management", "Urban farming", "Disaster resilience", "Mixed-use development",
    "Architecture integration", "Suburbanization", "City branding", "Participatory planning"
  ],
  "Urban Studies": [
    "Urban history", "City sociology", "Urban inequality", "Homelessness issues",
    "Migration to cities", "Urban economy", "City culture", "Street art",
    "Public spaces", "Subcultures", "Urban ecology", "Governance",
    "Crime and safety", "Digital cities", "Global cities", "Slums and ghettos",
    "Urban anthropology", "Nightlife economy", "Psychology of city life", "Demographic shifts"
  ],
  "Veterinary Science": [
    "Animal anatomy", "Pet nutrition", "Zoonotic diseases", "Vaccination for animals",
    "Surgery in animals", "Livestock health", "Wildlife medicine", "Animal behavior",
    "One Health concept", "Parasitology", "Exotic pets", "Veterinary ethics",
    "Animal shelters", "Emergency care", "Rehabilitation", "Diagnostics",
    "Pharmacology for vet", "Preventative care", "Public health role", "Human-animal bond"
  ]
};
