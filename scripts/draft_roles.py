#!/usr/bin/env python3
"""One-off: add the four drafted roles to data/roles.json and matching placeholder certificates
to data/sample. Kept in the repo so the team can see exactly what was generated, edit the lists
below, and re-run. Re-running replaces the four roles and the generated sample entries (s-1xx).

    python scripts/draft_roles.py

The skill trees are DRAFTS written by Claude (marked "draft": true). The team must review,
correct and own them before the originality declaration, as with Frontend.
"""
import json
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / "data"

def skill(id, name, description, keywords, prerequisites, resources):
    return {
        "id": id, "name": name, "description": description, "keywords": keywords,
        "prerequisites": prerequisites,
        "resources": [{"title": t, "url": u, "type": k} for t, u, k in resources],
    }

ROLES = {
    "backend": [
        skill("be-basics", "Programming fundamentals",
              "One server-side language well: variables, control flow, functions, data structures and object-oriented basics.",
              ["programming", "pemrograman", "python", "java", "golang", "go", "c#", "node.js", "algorithm", "algoritma", "oop", "data structures"],
              [], [("Python for Everybody", "https://www.py4e.com/", "course"), ("Learn Java (dev.java)", "https://dev.java/learn/", "docs")]),
        skill("be-git", "Git and the command line",
              "Version control with Git and getting around a terminal: branches, merges, pull requests, shells and scripts.",
              ["git", "github", "gitlab", "version control", "command line", "terminal", "bash", "shell", "linux"],
              [], [("Pro Git (book)", "https://git-scm.com/book/en/v2", "book"), ("The Missing Semester (MIT)", "https://missing.csail.mit.edu/", "course")]),
        skill("be-http", "HTTP and how the web works",
              "Requests, responses, status codes, headers, cookies and DNS: the protocol every backend speaks.",
              ["http", "https", "web", "internet", "dns", "tcp/ip", "networking", "jaringan"],
              ["be-basics"], [("An overview of HTTP (MDN)", "https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Overview", "docs")]),
        skill("be-sql", "SQL and relational databases",
              "Model data in tables, write queries and joins, use indexes and transactions in a relational database.",
              ["sql", "database", "basis data", "mysql", "postgresql", "sql server", "oracle database", "relational", "data modeling", "dbms"],
              ["be-basics"], [("SQLBolt", "https://sqlbolt.com/", "course"), ("PostgreSQL tutorial", "https://www.postgresql.org/docs/current/tutorial.html", "docs")]),
        skill("be-api", "Building REST APIs",
              "Design and build HTTP APIs with a framework: routing, JSON, validation, errors and documentation.",
              ["api", "rest", "restful", "web service", "backend", "back-end", "express", "django", "flask", "fastapi", "spring", "spring boot", "laravel", "json"],
              ["be-http", "be-sql"], [("FastAPI tutorial", "https://fastapi.tiangolo.com/tutorial/", "docs"), ("Express routing guide", "https://expressjs.com/en/guide/routing.html", "docs")]),
        skill("be-auth", "Authentication and API security",
              "Log users in safely and protect endpoints: sessions, tokens, OAuth, password storage and common attacks.",
              ["authentication", "authorization", "oauth", "jwt", "owasp", "api security", "keamanan", "security"],
              ["be-api"], [("OWASP Cheat Sheet Series", "https://cheatsheetseries.owasp.org/", "docs")]),
        skill("be-test", "Testing backend code",
              "Unit and integration tests that catch bugs before users do, and keep refactors safe.",
              ["testing", "software testing", "unit test", "integration test", "tdd", "pytest", "junit", "quality assurance", "qa"],
              ["be-api"], [("pytest: get started", "https://docs.pytest.org/en/stable/getting-started.html", "docs")]),
        skill("be-arch", "Architecture: services, queues and caching",
              "How larger systems fit together: monoliths and microservices, message queues, caches and scaling.",
              ["microservices", "architecture", "arsitektur", "system design", "message queue", "kafka", "rabbitmq", "redis", "caching", "scalability"],
              ["be-api"], [("The System Design Primer", "https://github.com/donnemartin/system-design-primer", "guide")]),
        skill("be-docker", "Containers and Docker",
              "Package an app with its dependencies, run it the same way everywhere, and automate builds with CI/CD.",
              ["docker", "container", "kubernetes", "devops", "ci/cd", "continuous integration", "deployment"],
              ["be-git", "be-api"], [("Docker: learn the basics", "https://docs.docker.com/learn/", "docs"), ("Kubernetes basics", "https://kubernetes.io/docs/tutorials/kubernetes-basics/", "course")]),
        skill("be-cloud", "Cloud deployment",
              "Run services on a cloud platform: compute, managed databases, storage, serverless and cost basics.",
              ["cloud", "cloud computing", "aws", "amazon web services", "azure", "google cloud", "gcp", "alibaba cloud", "serverless"],
              ["be-docker"], [("Google Skills (Google Cloud training)", "https://www.skills.google/", "course"), ("Microsoft Learn: Azure", "https://learn.microsoft.com/en-us/training/azure/", "course")]),
        skill("be-ship", "Capstone: ship a backend service",
              "Build, test, secure and deploy one real API end to end, with a README another developer can follow.",
              ["project", "portfolio", "capstone", "backend", "deployment"],
              ["be-cloud", "be-test", "be-auth"], [("The Twelve-Factor App", "https://12factor.net/", "guide")]),
    ],
    "data-analyst": [
        skill("da-excel", "Spreadsheets for analysis",
              "Clean, summarise and chart data in Excel or Google Sheets: formulas, lookups and pivot tables.",
              ["excel", "microsoft excel", "spreadsheet", "google sheets", "pivot table", "vlookup", "microsoft office", "office"],
              [], [("Excel help and learning (Microsoft)", "https://support.microsoft.com/en-us/excel", "docs"), ("Excel foundations (LearnFree, formerly GCFGlobal)", "https://www.learnfree.org/series/excel-foundations", "course")]),
        skill("da-stats", "Statistics fundamentals",
              "Describe data and reason about uncertainty: distributions, sampling, confidence intervals and hypothesis tests.",
              ["statistics", "statistika", "statistik", "probability", "probabilitas", "hypothesis testing", "regression", "descriptive statistics"],
              [], [("Statistics and probability (Khan Academy)", "https://www.khanacademy.org/math/statistics-probability", "course"), ("OpenIntro Statistics (free book)", "https://www.openintro.org/book/os/", "book")]),
        skill("da-sql", "SQL for analysis",
              "Pull the data you need from a database: filtering, joins, grouping and window functions.",
              ["sql", "database", "basis data", "query", "mysql", "postgresql", "bigquery", "data warehouse"],
              ["da-excel"], [("SQLBolt", "https://sqlbolt.com/", "course"), ("Intro to SQL (Kaggle Learn)", "https://www.kaggle.com/learn/intro-to-sql", "course")]),
        skill("da-python", "Python for data",
              "Load, reshape and summarise data with Python, pandas and notebooks.",
              ["python", "pandas", "numpy", "jupyter", "data analysis", "analisis data", "r programming", "data science"],
              ["da-stats"], [("Python (Kaggle Learn)", "https://www.kaggle.com/learn/python", "course"), ("Pandas (Kaggle Learn)", "https://www.kaggle.com/learn/pandas", "course")]),
        skill("da-clean", "Data cleaning and preparation",
              "Fix missing values, duplicates, wrong types and messy text so the analysis can be trusted.",
              ["data cleaning", "data wrangling", "data preparation", "etl", "data quality", "data transformation", "data processing"],
              ["da-python", "da-sql"], [("Data Cleaning (Kaggle Learn)", "https://www.kaggle.com/learn/data-cleaning", "course")]),
        skill("da-viz", "Data visualization",
              "Choose the right chart, label it honestly and tell a clear story with it.",
              ["data visualization", "visualisasi data", "visualization", "charts", "matplotlib", "seaborn", "storytelling", "infographic"],
              ["da-clean"], [("Data Visualization (Kaggle Learn)", "https://www.kaggle.com/learn/data-visualization", "course"), ("Fundamentals of Data Visualization (free book)", "https://clauswilke.com/dataviz/", "book")]),
        skill("da-bi", "BI dashboards",
              "Build interactive dashboards in Power BI, Tableau or Looker Studio that people actually use.",
              ["power bi", "tableau", "looker", "looker studio", "dashboard", "business intelligence", "bi", "reporting", "data studio"],
              ["da-viz"], [("Power BI (Microsoft Learn)", "https://learn.microsoft.com/en-us/training/powerplatform/power-bi", "course"), ("Tableau free training videos", "https://www.tableau.com/learn/training", "course")]),
        skill("da-think", "Asking the right business questions",
              "Turn a vague request into a measurable question, pick metrics, and explain what the numbers mean for a decision.",
              ["data analytics", "business analysis", "analytics", "kpi", "metrics", "a/b testing", "decision making", "business intelligence"],
              ["da-stats", "da-sql"], [("Think Stats (free book)", "https://greenteapress.com/wp/think-stats-2e/", "book")]),
        skill("da-ml", "Intro to machine learning for analysts",
              "When a simple predictive model helps, how to train and evaluate one, and how not to fool yourself.",
              ["machine learning", "ml", "predictive analytics", "scikit-learn", "classification", "regression", "artificial intelligence", "ai", "kecerdasan buatan"],
              ["da-python", "da-stats"], [("Intro to Machine Learning (Kaggle Learn)", "https://www.kaggle.com/learn/intro-to-machine-learning", "course"), ("Machine Learning Crash Course (Google)", "https://developers.google.com/machine-learning/crash-course", "course")]),
        skill("da-capstone", "Capstone: an end-to-end analysis",
              "Pick a public dataset, answer a real question with it, and publish the notebook and dashboard.",
              ["portfolio", "project", "case study", "capstone", "data analytics"],
              ["da-bi", "da-think"], [("Kaggle datasets", "https://www.kaggle.com/datasets", "data"), ("Satu Data Indonesia", "https://data.go.id/", "data")]),
    ],
    "ui-ux": [
        skill("ux-principles", "Visual design principles",
              "Hierarchy, spacing, typography, colour and contrast: what makes an interface easy to read and scan.",
              ["design", "desain", "ui", "ui design", "visual design", "graphic design", "typography", "color", "layout", "design principles"],
              [], [("Laws of UX", "https://lawsofux.com/", "guide"), ("Material Design 3", "https://m3.material.io/", "docs")]),
        skill("ux-research", "User research",
              "Learn what users need before designing: interviews, surveys, observation, personas and design thinking.",
              ["user research", "ux research", "interview", "survey", "persona", "empathy", "design thinking", "ux", "user experience"],
              [], [("UX research cheat sheet (NN/g)", "https://www.nngroup.com/articles/ux-research-cheat-sheet/", "article")]),
        skill("ux-ia", "Information architecture and user flows",
              "Organise content and map the steps people take: sitemaps, navigation, card sorting and journey maps.",
              ["information architecture", "user flow", "sitemap", "card sorting", "navigation", "journey map", "customer journey"],
              ["ux-research"], [("Information architecture articles (NN/g)", "https://www.nngroup.com/topic/information-architecture/", "article")]),
        skill("ux-wire", "Wireframing",
              "Sketch layouts quickly at low fidelity to test structure before spending time on visuals.",
              ["wireframe", "wireframing", "sketch", "low fidelity", "lo-fi", "balsamiq", "prototype"],
              ["ux-ia"], [("What is wireframing? (Figma)", "https://www.figma.com/resource-library/what-is-wireframing/", "article")]),
        skill("ux-figma", "Figma and high-fidelity design",
              "Turn wireframes into polished screens with auto layout, components, styles and variants.",
              ["figma", "adobe xd", "sketch app", "high fidelity", "mockup", "ui design", "prototyping", "canva"],
              ["ux-wire", "ux-principles"], [("Figma learn and help center", "https://help.figma.com/hc/en-us", "docs")]),
        skill("ux-a11y", "Accessibility",
              "Design for everyone: contrast, focus order, text alternatives, and the WCAG guidelines.",
              ["accessibility", "aksesibilitas", "wcag", "a11y", "inclusive design", "screen reader"],
              ["ux-principles"], [("Introduction to web accessibility (W3C WAI)", "https://www.w3.org/WAI/fundamentals/accessibility-intro/", "docs"), ("Learn Accessibility (web.dev)", "https://web.dev/learn/accessibility", "course")]),
        skill("ux-ds", "Design systems and components",
              "Reusable components, tokens and guidelines that keep a product consistent as it grows.",
              ["design system", "component library", "style guide", "atomic design", "design tokens", "material design"],
              ["ux-figma"], [("Material Design 3", "https://m3.material.io/", "docs"), ("Atlassian Design System", "https://atlassian.design/", "docs")]),
        skill("ux-proto", "Interaction design and prototyping",
              "Make designs clickable, design states and feedback, and use motion with purpose.",
              ["interaction design", "prototype", "prototyping", "microinteraction", "animation", "motion design", "ixd"],
              ["ux-figma"], [("Interaction Design Foundation: free literature", "https://ixdf.org/literature", "article")]),
        skill("ux-test", "Usability testing",
              "Watch real people use your prototype, find where they struggle, and fix it.",
              ["usability testing", "usability", "user testing", "heuristic evaluation", "a/b testing", "evaluation"],
              ["ux-proto", "ux-research"], [("Usability testing 101 (NN/g)", "https://www.nngroup.com/articles/usability-testing-101/", "article")]),
        skill("ux-handoff", "Working with developers",
              "Hand designs off cleanly: specs, responsive behaviour, edge cases, and enough HTML/CSS to talk shop.",
              ["handoff", "developer handoff", "html", "css", "front-end", "frontend", "responsive design", "dev mode"],
              ["ux-ds"], [("Learn Responsive Design (web.dev)", "https://web.dev/learn/design", "course")]),
        skill("ux-portfolio", "Capstone: a case study portfolio",
              "Write up one project from research to tested design, showing your decisions and what changed.",
              ["portfolio", "case study", "ux case study", "capstone", "project"],
              ["ux-test", "ux-handoff"], [("UX design portfolios (NN/g)", "https://www.nngroup.com/articles/ux-design-portfolios/", "article")]),
    ],
    "cybersecurity": [
        skill("sec-it", "IT and operating system basics",
              "How computers and operating systems work, and how to support and troubleshoot Windows and Linux machines.",
              ["it support", "operating system", "sistem operasi", "windows", "linux", "hardware", "troubleshooting", "komputer", "computer"],
              [], [("Professor Messer: free IT and security training videos", "https://www.professormesser.com/", "course")]),
        skill("sec-net", "Networking fundamentals",
              "IP addressing, TCP/UDP, routing, DNS and common protocols: the map attackers and defenders both use.",
              ["networking", "network", "jaringan", "jaringan komputer", "tcp/ip", "cisco", "ccna", "routing", "switching", "mikrotik", "dns"],
              ["sec-it"], [("Cloudflare Learning Center", "https://www.cloudflare.com/learning/", "docs"), ("Cisco Networking Academy (free courses)", "https://www.netacad.com/", "course")]),
        skill("sec-found", "Security fundamentals",
              "Confidentiality, integrity and availability, common threats, and the controls that stop them.",
              ["cybersecurity", "cyber security", "keamanan siber", "keamanan informasi", "information security", "security awareness", "network security", "nse", "fortinet"],
              ["sec-net"], [("Fortinet Training Institute (free NSE courses)", "https://training.fortinet.com/", "course"), ("NIST Cybersecurity Framework", "https://www.nist.gov/cyberframework", "docs")]),
        skill("sec-linux", "Linux and scripting for security",
              "Work comfortably in a Linux shell and automate small tasks with Bash or Python.",
              ["linux", "bash", "scripting", "python", "powershell", "command line", "shell"],
              ["sec-it"], [("OverTheWire: Bandit", "https://overthewire.org/wargames/bandit/", "practice"), ("The Linux Command Line (free book)", "https://linuxcommand.org/tlcl.php", "book")]),
        skill("sec-crypto", "Cryptography basics",
              "Hashing, symmetric and public-key encryption, certificates and TLS: what they protect and how they fail.",
              ["cryptography", "kriptografi", "encryption", "enkripsi", "tls", "ssl", "pki", "hashing"],
              ["sec-found"], [("Crypto 101 (free book)", "https://www.crypto101.io/", "book"), ("What is TLS? (Cloudflare)", "https://www.cloudflare.com/learning/ssl/transport-layer-security-tls/", "article")]),
        skill("sec-web", "Web application security",
              "The OWASP Top 10 in practice: injection, broken access control, XSS and how to test for them.",
              ["web security", "application security", "appsec", "owasp", "owasp top 10", "xss", "sql injection", "burp suite"],
              ["sec-found"], [("OWASP Top 10", "https://owasp.org/www-project-top-ten/", "docs"), ("Web Security Academy (PortSwigger)", "https://portswigger.net/web-security", "course")]),
        skill("sec-ops", "Security operations and monitoring",
              "SOC work: collect and read logs, spot suspicious activity with a SIEM, and follow an incident response plan.",
              ["soc", "security operations", "siem", "splunk", "monitoring", "incident response", "log analysis", "threat detection", "blue team"],
              ["sec-net", "sec-linux"], [("MITRE ATT&CK", "https://attack.mitre.org/", "docs")]),
        skill("sec-pentest", "Ethical hacking and penetration testing",
              "Find and responsibly report vulnerabilities in systems you are allowed to test.",
              ["penetration testing", "pentest", "ethical hacking", "ceh", "kali linux", "red team", "vulnerability assessment", "ctf", "hacking"],
              ["sec-web", "sec-linux"], [("picoCTF", "https://picoctf.org/", "practice"), ("Web Security Academy (PortSwigger)", "https://portswigger.net/web-security", "course")]),
        skill("sec-grc", "Risk, governance and compliance",
              "Assess risk, write policies and map controls to standards such as ISO 27001 and the NIST CSF.",
              ["risk management", "manajemen risiko", "governance", "compliance", "iso 27001", "nist", "audit", "it audit", "policy", "grc"],
              ["sec-found"], [("NIST Cybersecurity Framework", "https://www.nist.gov/cyberframework", "docs"), ("ISO/IEC 27001 overview", "https://www.iso.org/standard/27001", "docs")]),
        skill("sec-cloud", "Cloud security",
              "Identity and access, network controls, logging and shared responsibility on cloud platforms.",
              ["cloud security", "aws security", "azure security", "iam", "zero trust", "cloud"],
              ["sec-ops"], [("AWS Well-Architected: security pillar", "https://docs.aws.amazon.com/wellarchitected/latest/framework/security.html", "docs"), ("Cloud Security Alliance", "https://cloudsecurityalliance.org/", "docs")]),
        skill("sec-capstone", "Capstone: home lab and write-ups",
              "Build a small home lab, solve CTF challenges, and publish clear write-ups of what you found and fixed.",
              ["home lab", "capstone", "portfolio", "ctf", "write-up", "project"],
              ["sec-ops", "sec-pentest"], [("picoCTF", "https://picoctf.org/", "practice")]),
    ],
}

# Placeholder certificates for the sample dataset: one per new skill, with fictional providers,
# so every skill shows something in sample mode. (title, issuer, category, price IDR, hours, level, skill, relevance)
SAMPLE = [
    ("Programming Foundations with Python", "Sample Academy", "Programming", 0, 24, "Beginner", "be-basics", 0.9),
    ("Command Line and Git Basics", "OpenCert Sample", "Developer Tools", 0, 6, "Beginner", "be-git", 0.9),
    ("HTTP for Backend Developers", "Sample Tech Institute", "Web", 0, 5, "Beginner", "be-http", 0.9),
    ("Relational Databases and SQL", "Sample Academy", "Data", 200000, 20, "Beginner", "be-sql", 0.95),
    ("Building REST APIs", "Sample Bootcamp Co.", "Web Development", 450000, 30, "Intermediate", "be-api", 0.95),
    ("Securing Web APIs", "Sample Tech Institute", "Security", 300000, 12, "Intermediate", "be-auth", 0.9),
    ("Automated Testing for Services", "OpenCert Sample", "Programming", 0, 10, "Intermediate", "be-test", 0.85),
    ("Microservices Architecture Basics", "Sample Academy", "Software Architecture", 350000, 16, "Intermediate", "be-arch", 0.9),
    ("Containers with Docker", "Sample Bootcamp Co.", "DevOps", 250000, 12, "Intermediate", "be-docker", 0.95),
    ("Cloud Practitioner Essentials", "Sample Tech Institute", "Cloud", 0, 8, "Beginner", "be-cloud", 0.85),
    ("Backend Capstone Project", "Sample Campus Unit", "Career", 0, 40, "Advanced", "be-ship", 0.8),
    ("Spreadsheets for Data Analysis", "Sample Academy", "Office Skills", 0, 8, "Beginner", "da-excel", 0.9),
    ("Statistics for Everyone", "OpenCert Sample", "Data", 0, 20, "Beginner", "da-stats", 0.95),
    ("SQL for Data Analysts", "Sample Tech Institute", "Data", 150000, 12, "Beginner", "da-sql", 0.95),
    ("Python and Pandas for Data", "Sample Bootcamp Co.", "Data", 400000, 24, "Intermediate", "da-python", 0.95),
    ("Data Cleaning in Practice", "Sample Academy", "Data", 0, 6, "Intermediate", "da-clean", 0.9),
    ("Visualizing Data Clearly", "OpenCert Sample", "Data", 0, 8, "Beginner", "da-viz", 0.9),
    ("Dashboards with Power BI", "Sample Tech Institute", "Business Intelligence", 300000, 14, "Intermediate", "da-bi", 0.95),
    ("Analytical Thinking for Business", "Sample Campus Unit", "Career", 0, 6, "Beginner", "da-think", 0.8),
    ("Machine Learning Foundations", "Sample Academy", "AI", 500000, 30, "Intermediate", "da-ml", 0.85),
    ("Data Analytics Capstone", "Sample Bootcamp Co.", "Career", 600000, 40, "Advanced", "da-capstone", 0.85),
    ("Visual Design Basics for Screens", "Sample Academy", "Design", 0, 8, "Beginner", "ux-principles", 0.9),
    ("User Research Methods", "OpenCert Sample", "Design", 0, 10, "Beginner", "ux-research", 0.95),
    ("Information Architecture Essentials", "Sample Tech Institute", "Design", 150000, 8, "Intermediate", "ux-ia", 0.9),
    ("Wireframing Fast", "Sample Academy", "Design", 0, 4, "Beginner", "ux-wire", 0.9),
    ("UI Design with Figma", "Sample Bootcamp Co.", "Design", 350000, 18, "Beginner", "ux-figma", 0.95),
    ("Accessible Design", "OpenCert Sample", "Design", 0, 6, "Intermediate", "ux-a11y", 0.95),
    ("Building a Design System", "Sample Tech Institute", "Design", 400000, 14, "Advanced", "ux-ds", 0.9),
    ("Prototyping Interactions", "Sample Academy", "Design", 200000, 10, "Intermediate", "ux-proto", 0.9),
    ("Usability Testing in Practice", "Sample Campus Unit", "Design", 0, 6, "Intermediate", "ux-test", 0.9),
    ("Design Handoff for Developers", "OpenCert Sample", "Design", 0, 4, "Intermediate", "ux-handoff", 0.85),
    ("UX Case Study Portfolio", "Sample Bootcamp Co.", "Career", 500000, 30, "Advanced", "ux-portfolio", 0.85),
    ("IT Support Fundamentals", "Sample Academy", "IT Support", 0, 20, "Beginner", "sec-it", 0.9),
    ("Network Fundamentals", "Sample Tech Institute", "Networking", 250000, 24, "Beginner", "sec-net", 0.95),
    ("Introduction to Cybersecurity", "OpenCert Sample", "Security", 0, 10, "Beginner", "sec-found", 0.95),
    ("Linux for Security Analysts", "Sample Academy", "Security", 150000, 12, "Beginner", "sec-linux", 0.9),
    ("Applied Cryptography Basics", "Sample Tech Institute", "Security", 200000, 10, "Intermediate", "sec-crypto", 0.9),
    ("Web Application Security Testing", "Sample Bootcamp Co.", "Security", 450000, 20, "Intermediate", "sec-web", 0.95),
    ("SOC Analyst Essentials", "Sample Academy", "Security", 400000, 24, "Intermediate", "sec-ops", 0.95),
    ("Ethical Hacking Foundations", "Sample Bootcamp Co.", "Security", 500000, 30, "Intermediate", "sec-pentest", 0.9),
    ("Security Risk and Compliance", "OpenCert Sample", "Security", 0, 8, "Intermediate", "sec-grc", 0.85),
    ("Cloud Security Basics", "Sample Tech Institute", "Security", 300000, 10, "Intermediate", "sec-cloud", 0.9),
    ("Cybersecurity Home Lab Project", "Sample Campus Unit", "Career", 0, 30, "Advanced", "sec-capstone", 0.8),
]


def main():
    roles_path = DATA / "roles.json"
    roles = json.loads(roles_path.read_text(encoding="utf-8"))
    for r in roles:
        if r["id"] in ROLES:
            r["skills"] = ROLES[r["id"]]
            r["status"] = "available"
            r["draft"] = True
    roles_path.write_text(json.dumps(roles, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    certs_path, maps_path, meta_path = DATA / "sample" / "certificates.json", DATA / "sample" / "mappings.json", DATA / "sample" / "meta.json"
    certs = [c for c in json.loads(certs_path.read_text(encoding="utf-8")) if not c["id"].startswith("s-1")]
    maps = [m for m in json.loads(maps_path.read_text(encoding="utf-8")) if not m["certificateId"].startswith("s-1")]
    for i, (title, issuer, cat, price, hours, level, skill_id, rel) in enumerate(SAMPLE, start=101):
        cid = f"s-{i}"
        certs.append({
            "id": cid, "title": title, "issuer": issuer, "category": cat,
            "providerType": "campus" if issuer == "Sample Campus Unit" else "third_party",
            "url": None, "price": {"amount": price, "currency": "IDR"}, "hours": hours, "level": level,
            "source": "sample", "sample": True,
        })
        maps.append({"certificateId": cid, "skillId": skill_id, "relevance": rel, "method": "manual"})
    certs_path.write_text(json.dumps(certs, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    maps_path.write_text(json.dumps(maps, indent=2) + "\n", encoding="utf-8")
    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    meta["counts"] = {"certificates": len(certs), "mappings": len(maps)}
    meta_path.write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")
    print(f"roles: {', '.join(r['id'] + ('*' if r.get('draft') else '') for r in roles)}  (* = draft)")
    print(f"sample: {len(certs)} certificates, {len(maps)} mappings")


if __name__ == "__main__":
    main()
