export default {
  // 🌍 App Metadata
  app: {
    title: "WattAudit++ Explainable AI Dashboard",
    subtitle: "AI-powered Energy Anomaly Detection",
  },

  // ⚙️ Status Indicators
  status: {
    live_mode: "Live Mode: Neon + Local Fallback Enabled",
    anomalous: "Anomalous",
    normal: "Normal",
    stable: "Stable",
  },

  // 🏠 Customer Categories
  category_labels: {
    commercial: "Commercial",
    residential: "Residential",
    industrial: "Industrial",
  },

  // 🔘 Buttons
  button: {
    refresh: "Refresh",
    upload: "Upload",
    predict: "Predict",
  },

  // 📤 Upload Section
  upload: {
    heading: "Upload New Dataset (CSV)",
  },

  // 📊 Metrics Cards
  metrics: {
    total_customers: "Total Customers",
    ai_alerts: "AI Alerts",
    persistent_anomalies: "Persistent Anomalies",
    data_source: "Data Source",
    data_source_value: "Local / Neon",
    local_neon: "Local / Neon",

    // 👇 New metrics for Customer Detail
    total_records: "Total Records",
    last_updated: "Last Updated",
  },

  // 📈 Charts
  chart: {
    title: "Consumption vs Billing Trend",
    consumption: "Consumption",
    billed: "Billed",
    customer_id: "Customer ID",
    score: "Score",
    month_label: "Month",
    energy_unit: "Kilowatt-hours (kWh)",
  },

  // 🪄 Table Data
  table: {
    title: "Customer Insights Table",
    customer: "Customer",
    category: "Category",
    score: "Score",
    gap: "Gap",
    persistent: "Persistent",
    status: "Status",
    badge: "Badge",
    detailed_title: "Detailed Monthly Records",
    month: "Month",
    consumption_kwh: "Consumption (kWh)",
    billed_kwh: "Billed (kWh)",
  },

  // 🧍 Customer Detail Page
  customer: {
  details_title: "Customer Details",
  id: "ID",
  name: "Name",
  category: "Category",
  district: "District",
  substation: "Substation",
  install_year: "Install Year",
  meter_make: "Meter Make",
},


  // 🧠 Quick Insights Section
  quick_insights: "Quick Insights",
  top_reason_label: "Top Reason:",
  riskiest_category: "Riskiest Category:",
  alerts_delta: "Alerts Δ:",
  persistent_count: "Persistent Count:",
  regenerate: "Regenerate",
  generating_insights: "Generating insights…",
  no_insights: "No insights available",

  // 🚨 Top Flagged Section
  top_flagged: "Top Flagged Customers",
  repeated: "Repeated",
  single_anomaly: "Single Anomaly",

  // 🏷️ Badges
  badge: {
    anomaly: "Anomaly",
    normal: "Normal",
  },

  // 📅 Generic Labels
  label: {
    month: "Month",
    kwh: "Kilowatt-hour (kWh)",
    actions: "Actions",
  },

  // 🧮 Prediction Widget
  predict: {
    title: "Quick Prediction",
    input_placeholder_1: "Enter consumption value",
    input_placeholder_2: "Enter billed value",
    button: "Predict",
  },

  // 🎤 Voice Recognition
  voice: {
    listening: "Listening...",
    unsupported: "Your browser does not support voice recognition.",
    error: "There was a problem recognizing your voice. Please try again.",
    start: "Start voice input",
  },

  // 🔊 Playback Controls
  playback: {
    pause: "Pause",
    resume: "Resume",
    stop: "Stop",
  },

  // 📄 Pagination
  pagination: {
    showing: "Showing",
    of: "of",
    prev: "Prev",
    next: "Next",
  },

  // 🧩 General UI Helpers
  general: {
    yes: "Yes",
    no: "No",
    unknown: "Unknown",
    search_placeholder: "Search customers or score",
  },

  search: {
    placeholder: "Search customers or score",
  },

  // ✨ Extra dynamic strings (for backend values)
  extra_labels: {
    stable_pattern: "Stable consumption pattern (score={score})",
    unknown: "Unknown",
    local_neon: "Local / Neon",
    persistent_anomaly: "Persistent anomaly",
  },
    // 🤖 Copilot
  copilot: {
    open_copilot: "Open Copilot",
    close: "Close",
    placeholder: "Ask WattAudit Copilot... (English / Hindi / Marathi)",
    error: "Copilot failed to respond.",
  },

  // 🎙 Voice
 

  // 🔊 Audio
  audio: {
    on: "Unmute",
    off: "Mute",
  },

  // 💬 Default chat message
  start_chat: "Start chatting with your AI Copilot...",

};
