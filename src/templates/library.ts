import type { Template } from '#/types'
import { mod, tpl } from './helpers'

export const TEMPLATE_CATEGORIES = ['HR Management', 'Marketing', 'Sales', 'Lead Generation', 'Data Management', 'Other'] as const

const HR = 'HR Management'

const emp = () => mod('employees', 'Employees', 'Users', ['*Full Name:text', 'Email:email'], { color: '#7B68EE' })

export const BUILTIN_TEMPLATES: Template[] = [
  // ---------------- HR Management ----------------
  tpl({
    id: 'hr-employee-management', name: 'Employee Management', category: HR, icon: 'UsersRound', color: '#7B68EE',
    description: 'Employee directory with departments, managers, employment type and start dates.',
    modules: [
      mod('departments', 'Departments', 'Network', ['*Department Name:text', 'Head:user', 'Budget:cur', 'Description:long']),
      mod('employees', 'Employees', 'Users', ['*Full Name:text', 'Employee ID:id:EMP', 'Work Email:email', 'Phone:phone', 'Department:rel:departments', 'Job Title:text', 'Employment Type:sel:Full-time,Part-time,Contractor,Intern', 'Status:sel:Active,On leave,Terminated', 'Start Date:date', 'Salary:cur', 'Photo:img', 'Home Address:addr']),
    ],
  }),
  tpl({
    id: 'hr-recruitment', name: 'Recruitment', category: HR, icon: 'UserSearch', color: '#FD71AF',
    description: 'Open positions and a candidate pipeline from sourcing to offer.',
    modules: [
      mod('positions', 'Positions', 'Briefcase', ['*Position Title:text', 'Department:text', 'Status:sel:Open,On hold,Filled,Closed', 'Location:text', 'Salary Range:text', 'Hiring Manager:user', 'Opened On:date', 'Description:long']),
      mod('candidates', 'Candidates', 'UserPlus', ['*Candidate Name:text', 'Email:email', 'Phone:phone', 'Position:rel:positions', 'Stage:sel:Sourced,Screening,Interview,Offer,Hired,Rejected', 'Source:sel:LinkedIn,Referral,Job board,Agency,Other', 'Rating:rate', 'Resume:doc', 'Notes:long']),
    ],
  }),
  tpl({
    id: 'hr-job-applications', name: 'Job Applications', category: HR, icon: 'FileUser', color: '#3B9DF8',
    description: 'Track incoming applications and review decisions.',
    modules: [
      mod('jobs', 'Jobs', 'Briefcase', ['*Job Title:text', 'Status:sel:Open,Closed', 'Location:text']),
      mod('applications', 'Applications', 'FileUser', ['*Applicant Name:text', 'Email:email', 'Phone:phone', 'Job:rel:jobs', 'Status:sel:Received,In review,Shortlisted,Rejected,Hired', 'Applied On:date', 'Cover Letter:long', 'Resume:doc', 'Score:rate']),
    ],
  }),
  tpl({
    id: 'hr-interview-tracking', name: 'Interview Tracking', category: HR, icon: 'CalendarCheck', color: '#2DB67D',
    description: 'Schedule interviews, collect scores and feedback.',
    modules: [
      mod('interviews', 'Interviews', 'CalendarCheck', ['*Candidate:text', 'Round:sel:Phone screen,Technical,Culture fit,Final', 'Interview Date:dt', 'Interviewer:user', 'Status:sel:Scheduled,Completed,Cancelled,No-show', 'Score:rate', 'Recommendation:sel:Strong yes,Yes,No,Strong no', 'Feedback:long']),
    ],
  }),
  tpl({
    id: 'hr-attendance', name: 'Attendance', category: HR, icon: 'Clock', color: '#F5A524',
    description: 'Daily clock-in / clock-out log with worked hours.',
    modules: [
      emp(),
      mod('attendance', 'Attendance Log', 'Clock', ['*Day Label:text', 'Employee:rel:employees', 'Date:date', 'Clock In:time', 'Clock Out:time', 'Status:sel:Present,Absent,Late,Remote,Half day', 'Hours Worked:num', 'Notes:long']),
    ],
  }),
  tpl({
    id: 'hr-leave', name: 'Leave Management', category: HR, icon: 'Palmtree', color: '#14B8A6',
    description: 'Leave requests with approvals and day counts.',
    modules: [
      emp(),
      mod('leave', 'Leave Requests', 'Palmtree', ['*Request Title:text', 'Employee:rel:employees', 'Leave Type:sel:Annual,Sick,Parental,Unpaid,Other', 'Start Date:date', 'End Date:date', 'Days:f:DAYS_BETWEEN({start_date},{end_date})+1', 'Status:sel:Pending,Approved,Rejected', 'Approver:user', 'Reason:long']),
    ],
  }),
  tpl({
    id: 'hr-payroll', name: 'Payroll Tracking', category: HR, icon: 'Wallet', color: '#A855F7',
    description: 'Pay runs with gross, deductions and net pay calculated automatically.',
    modules: [
      emp(),
      mod('payroll', 'Pay Runs', 'Wallet', ['*Pay Period:text', 'Employee:rel:employees', 'Pay Date:date', 'Gross Pay:cur', 'Deductions:cur', 'Net Pay:f:{gross_pay}-{deductions}', 'Status:sel:Draft,Approved,Paid', 'Notes:long']),
    ],
  }),
  tpl({
    id: 'hr-performance', name: 'Performance Reviews', category: HR, icon: 'TrendingUp', color: '#FD71AF',
    description: 'Review cycles with ratings, goals and manager feedback.',
    modules: [
      emp(),
      mod('reviews', 'Reviews', 'ClipboardCheck', ['*Review Title:text', 'Employee:rel:employees', 'Reviewer:user', 'Cycle:sel:Q1,Q2,Q3,Q4,Annual', 'Status:sel:Not started,In progress,Completed', 'Overall Rating:rate', 'Goals Met:pct', 'Strengths:long', 'Areas to Improve:long', 'Review Date:date']),
    ],
  }),
  tpl({
    id: 'hr-documents', name: 'Employee Documents', category: HR, icon: 'FolderLock', color: '#64748B',
    description: 'Contracts, IDs and certificates with expiry tracking.',
    modules: [
      emp(),
      mod('emp_docs', 'Employee Documents', 'FolderLock', ['*Document Title:text', 'Employee:rel:employees', 'Type:sel:Contract,ID,Certificate,Tax form,Other', 'File:doc', 'Issued On:date', 'Expires On:date', 'Status:sel:Valid,Expiring,Expired', 'Signature:sig']),
    ],
  }),

  // ---------------- Marketing ----------------
  tpl({
    id: 'mkt-campaigns', name: 'Campaign Management', category: 'Marketing', icon: 'Megaphone', color: '#FD71AF',
    description: 'Plan campaigns, budgets and results across channels.',
    modules: [
      mod('campaigns', 'Campaigns', 'Megaphone', ['*Campaign Name:text', 'Channel:sel:Email,Social,Paid ads,Events,Content,SEO', 'Status:sel:Planned,Running,Paused,Completed', 'Owner:user', 'Start Date:date', 'End Date:date', 'Budget:cur', 'Spend:cur', 'Leads Generated:num', 'Cost per Lead:f:IF({leads_generated}>0,ROUND({spend}/{leads_generated},2),0)', 'Goals:long']),
    ],
  }),
  tpl({
    id: 'mkt-content', name: 'Content Calendar', category: 'Marketing', icon: 'CalendarDays', color: '#7B68EE',
    description: 'Editorial calendar for posts, articles and videos.',
    modules: [
      mod('content', 'Content', 'PenSquare', ['*Title:text', 'Type:sel:Blog,Video,Social post,Newsletter,Podcast', 'Status:sel:Idea,Drafting,Review,Scheduled,Published', 'Author:user', 'Publish Date:date', 'Channel:text', 'Cover:img', 'URL:url', 'Brief:long']),
    ],
  }),
  tpl({
    id: 'mkt-social', name: 'Social Media Planner', category: 'Marketing', icon: 'Share2', color: '#3B9DF8',
    description: 'Schedule social posts and track engagement.',
    modules: [
      mod('posts', 'Social Posts', 'Share2', ['*Post Title:text', 'Platform:sel:Instagram,LinkedIn,X,Facebook,TikTok,YouTube', 'Status:sel:Draft,Scheduled,Posted', 'Scheduled For:dt', 'Image:img', 'Likes:num', 'Comments:num', 'Shares:num', 'Engagement:f:{likes}+{comments}+{shares}', 'Caption:long']),
    ],
  }),
  tpl({
    id: 'mkt-email', name: 'Email Marketing', category: 'Marketing', icon: 'MailCheck', color: '#2DB67D',
    description: 'Newsletters with audience, send date and performance.',
    modules: [
      mod('emails', 'Email Campaigns', 'MailCheck', ['*Subject Line:text', 'List:text', 'Status:sel:Draft,Scheduled,Sent', 'Send Date:dt', 'Recipients:num', 'Opens:num', 'Clicks:num', 'Open Rate:f:IF({recipients}>0,ROUND({opens}/{recipients}*100,1),0)', 'Body:long']),
    ],
  }),

  // ---------------- Sales ----------------
  tpl({
    id: 'sales-pipeline', name: 'Sales Pipeline', category: 'Sales', icon: 'Filter', color: '#7B68EE',
    description: 'Accounts and a staged deal pipeline with weighted forecasts.',
    modules: [
      mod('accounts', 'Accounts', 'Building2', ['*Account Name:text', 'Industry:text', 'Website:url', 'Owner:user']),
      mod('opps', 'Opportunities', 'Handshake', ['*Opportunity:text', 'Account:rel:accounts', 'Stage:sel:Discovery,Demo,Proposal,Negotiation,Closed won,Closed lost', 'Amount:cur', 'Probability:pct', 'Close Date:date', 'Owner:user', 'Forecast:f:{amount}*{probability}/100', 'Next Step:long']),
    ],
  }),
  tpl({
    id: 'sales-quotes', name: 'Quotes & Invoices', category: 'Sales', icon: 'Receipt', color: '#F5A524',
    description: 'Quotes and invoices with automatic totals and tax.',
    modules: [
      mod('quotes', 'Quotes', 'Receipt', ['*Quote Number:id:QT', 'Customer:text', 'Status:sel:Draft,Sent,Accepted,Rejected', 'Issue Date:date', 'Valid Until:date', 'Subtotal:cur', 'Tax Rate:pct', 'Total:f:ROUND({subtotal}*(1+{tax_rate}/100),2)', 'Terms:long']),
      mod('invoices', 'Invoices', 'FileSpreadsheet', ['*Invoice Number:id:INV', 'Customer:text', 'Status:sel:Draft,Sent,Paid,Overdue', 'Issue Date:date', 'Due Date:date', 'Subtotal:cur', 'Tax Rate:pct', 'Total:f:ROUND({subtotal}*(1+{tax_rate}/100),2)', 'Attachment:doc']),
    ],
  }),
  tpl({
    id: 'sales-accounts', name: 'Account Management', category: 'Sales', icon: 'Handshake', color: '#2DB67D',
    description: 'Manage key accounts, renewals and health.',
    modules: [
      mod('acct', 'Key Accounts', 'Gem', ['*Account:text', 'Tier:sel:Strategic,Growth,Standard', 'Health:sel:Healthy,Needs attention,At risk', 'Manager:user', 'ARR:cur', 'Renewal Date:date', 'Primary Contact:text', 'Email:email', 'Notes:long']),
    ],
  }),
  tpl({
    id: 'sales-commissions', name: 'Sales Targets', category: 'Sales', icon: 'Trophy', color: '#FD71AF',
    description: 'Quota, attainment and commission per rep.',
    modules: [
      mod('targets', 'Targets', 'Trophy', ['*Rep & Period:text', 'Rep:user', 'Quota:cur', 'Closed Revenue:cur', 'Attainment:f:IF({quota}>0,ROUND({closed_revenue}/{quota}*100,1),0)', 'Commission Rate:pct', 'Commission:f:ROUND({closed_revenue}*{commission_rate}/100,2)', 'Period Start:date']),
    ],
  }),

  // ---------------- Lead Generation ----------------
  tpl({
    id: 'lead-capture', name: 'Lead Capture', category: 'Lead Generation', icon: 'Magnet', color: '#7B68EE',
    description: 'Capture leads from public forms, score and qualify them.',
    modules: [
      mod('captured', 'Captured Leads', 'Magnet', ['*Name:text', 'Email:email', 'Phone:phone', 'Company:text', 'Source:sel:Landing page,Webinar,Ad,Referral,Cold outreach', 'Status:sel:New,Contacted,Qualified,Disqualified', 'Score:rate', 'Interested In:multi:Product A,Product B,Consulting,Support', 'Consent:bool', 'Message:long']),
    ],
  }),
  tpl({
    id: 'lead-outreach', name: 'Outreach Tracker', category: 'Lead Generation', icon: 'Send', color: '#FD71AF',
    description: 'Sequence outreach touches and replies.',
    modules: [
      mod('prospects', 'Prospects', 'Crosshair', ['*Prospect:text', 'Company:text', 'Email:email', 'Linkedin:url', 'Stage:sel:To contact,Contacted,Replied,Meeting booked,Not interested', 'Touches:num', 'Last Touch:date', 'Next Touch:date', 'Owner:user', 'Notes:long']),
    ],
  }),
  tpl({
    id: 'lead-events', name: 'Event Leads', category: 'Lead Generation', icon: 'Ticket', color: '#14B8A6',
    description: 'Leads collected at events and trade shows.',
    modules: [
      mod('events', 'Events', 'Ticket', ['*Event Name:text', 'Date:date', 'Location:text', 'Budget:cur']),
      mod('event_leads', 'Event Leads', 'ScanLine', ['*Lead Name:text', 'Event:rel:events', 'Email:email', 'Phone:phone', 'Company:text', 'Interest Level:sel:Hot,Warm,Cold', 'Follow-up Status:sel:Pending,Done', 'Notes:long']),
    ],
  }),

  // ---------------- Data Management ----------------
  tpl({
    id: 'data-registry', name: 'Data Registry', category: 'Data Management', icon: 'Database', color: '#64748B',
    description: 'A flexible catalog of datasets, owners and sensitivity.',
    modules: [
      mod('datasets', 'Datasets', 'Database', ['*Dataset Name:text', 'Owner:user', 'Source:text', 'Sensitivity:sel:Public,Internal,Confidential,Restricted', 'Status:sel:Active,Deprecated,Archived', 'Refresh:sel:Real-time,Daily,Weekly,Monthly,Manual', 'Last Updated:date', 'Tags:tags', 'Description:long']),
    ],
  }),
  tpl({
    id: 'data-assets', name: 'Asset Register', category: 'Data Management', icon: 'Laptop', color: '#3B9DF8',
    description: 'Track company equipment, assignees and warranty dates.',
    modules: [
      mod('assets', 'Assets', 'Laptop', ['*Asset Name:text', 'Asset Tag:id:AST', 'Category:sel:Laptop,Phone,Monitor,Furniture,Vehicle,Other', 'Status:sel:In use,In stock,In repair,Retired', 'Assigned To:user', 'Purchase Date:date', 'Cost:cur', 'Warranty Until:date', 'Photo:img', 'Notes:long']),
    ],
  }),
  tpl({
    id: 'data-contacts', name: 'Contact Database', category: 'Data Management', icon: 'BookUser', color: '#2DB67D',
    description: 'A clean master list of people and organisations.',
    modules: [
      mod('orgs', 'Organisations', 'Landmark', ['*Organisation:text', 'Type:sel:Customer,Partner,Vendor,Other', 'Website:url']),
      mod('people', 'People', 'BookUser', ['*Name:text', 'Organisation:rel:orgs', 'Email:email', 'Phone:phone', 'Role:text', 'Tags:tags', 'Notes:long']),
    ],
  }),

  // ---------------- Other ----------------
  tpl({
    id: 'other-truck-dispatch', name: 'Truck Dispatching', category: 'Other', icon: 'Truck', color: '#F5A524',
    description: 'Drivers, trucks and loads with rates and delivery status.',
    modules: [
      mod('drivers', 'Drivers', 'UserCog', ['*Driver Name:text', 'Phone:phone', 'License Number:text', 'License Expiry:date', 'Status:sel:Available,On route,Off duty']),
      mod('trucks', 'Trucks', 'Truck', ['*Truck Number:text', 'Type:sel:Dry van,Reefer,Flatbed,Box truck', 'Status:sel:Available,On route,Maintenance', 'Driver:rel:drivers', 'Insurance Expiry:date']),
      mod('loads', 'Loads', 'PackageCheck', ['*Load Number:id:LD', 'Broker / Customer:text', 'Status:sel:Booked,Dispatched,In transit,Delivered,Invoiced', 'Truck:rel:trucks', 'Driver:rel:drivers', 'Pickup Location:text', 'Pickup Date:dt', 'Delivery Location:text', 'Delivery Date:dt', 'Miles:num', 'Rate:cur', 'Rate per Mile:f:IF({miles}>0,ROUND({rate}/{miles},2),0)', 'POD:doc']),
    ],
  }),
  tpl({
    id: 'other-logistics', name: 'Logistics', category: 'Other', icon: 'Container', color: '#3B9DF8',
    description: 'Shipments, carriers and tracking numbers.',
    modules: [
      mod('carriers', 'Carriers', 'Ship', ['*Carrier:text', 'Mode:sel:Road,Air,Sea,Rail', 'Contact Email:email', 'Rating:rate']),
      mod('shipments', 'Shipments', 'Container', ['*Reference:id:SH', 'Customer:text', 'Status:sel:Pending,In transit,Customs,Delivered,Delayed', 'Carrier:rel:carriers', 'Origin:text', 'Destination:text', 'Ship Date:date', 'ETA:date', 'Tracking Number:text', 'Weight (kg):num', 'Cost:cur']),
    ],
  }),
  tpl({
    id: 'other-real-estate', name: 'Real Estate CRM', category: 'Other', icon: 'Home', color: '#2DB67D',
    description: 'Listings, buyers and showings.',
    modules: [
      mod('listings', 'Listings', 'Home', ['*Address:text', 'Status:sel:Draft,Active,Under offer,Sold,Withdrawn', 'Type:sel:House,Apartment,Land,Commercial', 'Price:cur', 'Bedrooms:num', 'Bathrooms:num', 'Area (sqft):num', 'Agent:user', 'Photos:img', 'Description:long']),
      mod('buyers', 'Buyers', 'UserCheck', ['*Buyer Name:text', 'Email:email', 'Phone:phone', 'Budget:cur', 'Stage:sel:New,Viewing,Offer made,Closed,Lost', 'Preferred Listing:rel:listings', 'Notes:long']),
      mod('showings', 'Showings', 'KeyRound', ['*Showing:text', 'Listing:rel:listings', 'Buyer:rel:buyers', 'When:dt', 'Status:sel:Scheduled,Done,Cancelled', 'Feedback:long']),
    ],
  }),
  tpl({
    id: 'other-property-mgmt', name: 'Property Management', category: 'Other', icon: 'Building', color: '#7B68EE',
    description: 'Properties, tenants, leases, rent and maintenance requests.',
    modules: [
      mod('properties', 'Properties', 'Building', ['*Property Name:text', 'Address:addr', 'Units:num', 'Manager:user']),
      mod('tenants', 'Tenants', 'Users', ['*Tenant Name:text', 'Email:email', 'Phone:phone', 'Property:rel:properties', 'Unit:text', 'Lease Start:date', 'Lease End:date', 'Monthly Rent:cur', 'Status:sel:Active,Notice given,Past']),
      mod('maintenance', 'Maintenance Requests', 'Wrench', ['*Issue:text', 'Property:rel:properties', 'Tenant:rel:tenants', 'Priority:sel:Low,Medium,High,Emergency', 'Status:sel:Open,In progress,Resolved', 'Reported On:date', 'Photos:img', 'Cost:cur', 'Details:long']),
    ],
  }),
  tpl({
    id: 'other-recruitment-agency', name: 'Recruitment Agency', category: 'Other', icon: 'Handshake', color: '#FD71AF',
    description: 'Clients, job orders, candidates and placements with fees.',
    modules: [
      mod('clients', 'Clients', 'Building2', ['*Client:text', 'Contact Name:text', 'Email:email', 'Fee %:pct', 'Status:sel:Prospect,Active,Inactive']),
      mod('orders', 'Job Orders', 'ClipboardList', ['*Job Title:text', 'Client:rel:clients', 'Status:sel:Open,Interviewing,Filled,Closed', 'Openings:num', 'Salary:cur', 'Opened:date']),
      mod('cands', 'Candidates', 'UserSearch', ['*Candidate:text', 'Email:email', 'Phone:phone', 'Job Order:rel:orders', 'Stage:sel:Submitted,Interview,Offer,Placed,Rejected', 'Expected Salary:cur', 'Placement Fee:f:{expected_salary}*0.2', 'CV:doc']),
    ],
  }),
  tpl({
    id: 'other-project-mgmt', name: 'Project Management', category: 'Other', icon: 'KanbanSquare', color: '#A855F7',
    description: 'Projects, milestones and tasks with progress tracking.',
    modules: [
      mod('pm_projects', 'Projects', 'FolderKanban', ['*Project:text', 'Status:sel:Planning,Active,On hold,Done', 'Owner:user', 'Start:date', 'Deadline:date', 'Budget:cur', 'Progress:pct']),
      mod('pm_tasks', 'Project Tasks', 'ListTodo', ['*Task:text', 'Project:rel:pm_projects', 'Status:sel:Backlog,To do,In progress,Review,Done', 'Priority:sel:Low,Medium,High,Urgent', 'Assignee:user', 'Due:date', 'Estimate (h):num', 'Description:long']),
    ],
  }),
  tpl({
    id: 'other-support', name: 'Customer Support', category: 'Other', icon: 'Headset', color: '#14B8A6',
    description: 'Support tickets with priority, SLA and satisfaction.',
    modules: [
      mod('tickets', 'Tickets', 'LifeBuoy', ['*Subject:text', 'Ticket #:id:TKT', 'Customer:text', 'Email:email', 'Status:sel:Open,Pending,Resolved,Closed', 'Priority:sel:Low,Normal,High,Urgent', 'Channel:sel:Email,Chat,Phone,Social', 'Assignee:user', 'Opened:date', 'Satisfaction:rate', 'Description:long', 'Attachments:file']),
    ],
  }),
  tpl({
    id: 'other-inventory', name: 'Inventory Management', category: 'Other', icon: 'Boxes', color: '#F5A524',
    description: 'Products, stock levels, suppliers and reorder alerts.',
    modules: [
      mod('suppliers', 'Suppliers', 'Factory', ['*Supplier:text', 'Email:email', 'Phone:phone', 'Lead Time (days):num']),
      mod('products', 'Products', 'Package', ['*Product:text', 'SKU:id:SKU', 'Category:text', 'Supplier:rel:suppliers', 'Unit Cost:cur', 'Unit Price:cur', 'In Stock:num', 'Reorder Level:num', 'Stock Status:f:IF({in_stock}<={reorder_level},"Reorder","OK")', 'Stock Value:f:{in_stock}*{unit_cost}', 'Image:img']),
    ],
  }),
  tpl({
    id: 'other-finance', name: 'Finance Tracking', category: 'Other', icon: 'PiggyBank', color: '#2DB67D',
    description: 'Income and expenses with categories and approvals.',
    modules: [
      mod('transactions', 'Transactions', 'ArrowLeftRight', ['*Description:text', 'Type:sel:Income,Expense', 'Category:sel:Sales,Services,Payroll,Rent,Software,Marketing,Travel,Other', 'Amount:cur', 'Date:date', 'Status:sel:Pending,Approved,Reimbursed', 'Account:text', 'Receipt:file']),
      mod('budgets', 'Budgets', 'Gauge', ['*Budget:text', 'Category:text', 'Period:sel:Monthly,Quarterly,Yearly', 'Planned:cur', 'Actual:cur', 'Remaining:f:{planned}-{actual}', 'Used:f:IF({planned}>0,ROUND({actual}/{planned}*100,1),0)']),
    ],
  }),
  tpl({
    id: 'other-operations', name: 'Operations Management', category: 'Other', icon: 'Cog', color: '#64748B',
    description: 'Processes, incidents and vendors for day-to-day operations.',
    modules: [
      mod('processes', 'Processes', 'Workflow', ['*Process:text', 'Owner:user', 'Status:sel:Draft,Active,Under review', 'Frequency:sel:Daily,Weekly,Monthly,Ad hoc', 'Last Review:date', 'Documentation:doc']),
      mod('incidents', 'Incidents', 'AlertTriangle', ['*Incident:text', 'Severity:sel:Low,Medium,High,Critical', 'Status:sel:Reported,Investigating,Resolved', 'Reported By:user', 'Reported On:dt', 'Resolution:long']),
      mod('vendors', 'Vendors', 'Store', ['*Vendor:text', 'Service:text', 'Contract End:date', 'Annual Cost:cur', 'Contact Email:email', 'Rating:rate']),
    ],
  }),
]
