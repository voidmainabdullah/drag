import { mod, tpl } from './helpers'

/** Default Business Management modules, installed into every new workspace through the generic installer. */
export const coreTemplate = tpl({
  id: 'core-business',
  name: 'Core CRM',
  category: 'Sales',
  description: 'Contacts, companies, leads, customers, deals, activities, documents and projects.',
  icon: 'Building2',
  dashboardName: 'Business overview',
  modules: [
    mod('contacts', 'Contacts', 'Contact', ['*Full Name:text', 'Email:email', 'Phone:phone', 'Job Title:text', 'Company:rel:companies', 'Status:sel:Lead,Active,Inactive', 'Owner:user', 'Tags:tags', 'Notes:long'], { color: '#7B68EE' }),
    mod('companies', 'Companies', 'Building2', ['*Company Name:text', 'Website:url', 'Industry:sel:Technology,Finance,Healthcare,Retail,Manufacturing,Services,Other', 'Size:sel:1-10,11-50,51-200,201-1000,1000+', 'Phone:phone', 'Account Owner:user', 'Annual Revenue:cur', 'Address:addr'], { color: '#3B9DF8' }),
    mod('leads', 'Leads', 'Target', ['*Lead Name:text', 'Email:email', 'Phone:phone', 'Source:sel:Website,Referral,Social,Email,Event,Other', 'Status:sel:New,Contacted,Qualified,Converted,Lost', 'Estimated Value:cur', 'Assigned To:user', 'Next Follow-up:date', 'Notes:long'], { color: '#F5A524' }),
    mod('customers', 'Customers', 'HeartHandshake', ['*Customer Name:text', 'Email:email', 'Phone:phone', 'Company:rel:companies', 'Customer Since:date', 'Plan:sel:Free,Starter,Pro,Enterprise', 'Lifetime Value:cur', 'Account Manager:user', 'Health:sel:Healthy,At risk,Churned'], { color: '#2DB67D' }),
    mod('deals', 'Deals', 'Handshake', ['*Deal Name:text', 'Stage:sel:Prospecting,Qualification,Proposal,Negotiation,Won,Lost', 'Amount:cur', 'Probability:pct', 'Expected Close:date', 'Contact:rel:contacts', 'Company:rel:companies', 'Owner:user', 'Weighted Value:f:{amount}*{probability}/100'], { color: '#FD71AF' }),
    mod('activities', 'Activities', 'Activity', ['*Subject:text', 'Type:sel:Call,Email,Meeting,Note,Task', 'Date:dt', 'Status:sel:Planned,Done,Cancelled', 'Contact:rel:contacts', 'Deal:rel:deals', 'Notes:long'], { color: '#14B8A6' }),
    mod('documents', 'Documents', 'FileText', ['*Document Name:text', 'Type:sel:Contract,Proposal,Invoice,Report,Other', 'Status:sel:Draft,Sent,Signed,Expired', 'File:doc', 'Company:rel:companies', 'Deal:rel:deals', 'Expiry Date:date'], { color: '#64748B' }),
    mod('projects', 'Projects', 'FolderKanban', ['*Project Name:text', 'Status:sel:Planning,Active,On Hold,Completed', 'Priority:sel:Low,Medium,High', 'Start Date:date', 'Due Date:date', 'Budget:cur', 'Progress:pct', 'Owner:user', 'Company:rel:companies', 'Description:long'], { color: '#A855F7' }),
  ],
})
