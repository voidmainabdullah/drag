/**
 * MOCKED model output for "Letting agency CRM" (landlords, properties, enquiries, tenants, tenancies, rent payments).
 * Hand-written stand-in for a model answer; it is NOT produced by a live model.
 */
const money = (id: string, label: string, extra: Record<string, unknown> = {}) => ({ id, label, type: 'currency', currency: 'GBP', precision: 2, ...extra })
const rel = (id: string, label: string, source: string, target: string, extra: Record<string, unknown> = {}) => ({ id, label, sourceModuleId: source, targetModuleId: target, cardinality: 'many-to-one', deletePolicy: 'restrict', ...extra })
const rent = (amount: number) => ({ moduleId: 'rent_payments', values: [{ fieldId: 'amount', value: amount }], linksToSelfVia: ['property'] })
const enquiry = () => ({ moduleId: 'enquiries', values: [{ fieldId: 'name', value: 'Sam' }], linksToSelfVia: ['property'] })
const tenancy = (stage: string) => ({ moduleId: 'tenancies', values: [{ fieldId: 'reference', value: 'T-1' }, { fieldId: 'tenancy_stage', value: stage }], linksToSelfVia: ['property'] })
const paidOn = (amount: number) => ({ moduleId: 'rent_payments', values: [{ fieldId: 'amount', value: amount }], linksToSelfVia: ['tenancy'] })
const t = (name: string, related: unknown[], expected: string | null) => ({ name, record: [], related, today: '2026-02-01', expected })
const base = { precision: 2, rounding: 'half_up', nullBehavior: 'zero', divByZero: 'null' }

export function lettingBlueprint(projectId: string, revisionId: string): Record<string, unknown> {
  return {
    meta: { name: 'Letting agency CRM', description: 'Landlords, properties, enquiries, tenants, tenancies and rent', domain: 'real_estate', locale: 'en-GB', currency: 'GBP', timezone: 'Europe/London', blueprintVersion: '1.0.0', schemaVersion: 1, projectId, revisionId },
    roles: [{ id: 'negotiator', name: 'Negotiator', description: 'Viewings and enquiries, no money', grants: ['viewModules', 'createRecords', 'editRecords'] }],
    modules: [
      { id: 'landlords', singular: 'Landlord', plural: 'Landlords', kind: 'entity', icon: 'Users', titleTemplate: '{full_name}', fields: [{ id: 'full_name', label: 'Full name', type: 'shortText', required: true }, { id: 'phone', label: 'Phone', type: 'phone' }] },
      {
        id: 'properties', singular: 'Property', plural: 'Properties', kind: 'entity', icon: 'Home', titleTemplate: '{address}',
        fields: [{ id: 'address', label: 'Address', type: 'shortText', required: true, unique: true }, money('monthly_rent', 'Monthly rent', { min: 0 }), { id: 'bedrooms', label: 'Bedrooms', type: 'number' }],
      },
      { id: 'enquiries', singular: 'Enquiry', plural: 'Enquiries', kind: 'entity', icon: 'MessageSquare', titleTemplate: '{name}', fields: [{ id: 'name', label: 'Name', type: 'shortText', required: true }, { id: 'email', label: 'Email', type: 'email' }] },
      { id: 'tenants', singular: 'Tenant', plural: 'Tenants', kind: 'entity', icon: 'User', titleTemplate: '{full_name}', fields: [{ id: 'full_name', label: 'Full name', type: 'shortText', required: true }, { id: 'email', label: 'Email', type: 'email' }] },
      {
        id: 'tenancies', singular: 'Tenancy', plural: 'Tenancies', kind: 'entity', icon: 'FileText', titleTemplate: '{reference}',
        fields: [{ id: 'reference', label: 'Reference', type: 'shortText', required: true, unique: true }, { id: 'start_date', label: 'Start date', type: 'date', required: true }, { id: 'end_date', label: 'End date', type: 'date' }, money('rent', 'Monthly rent', { required: true, min: 0 })],
      },
      {
        id: 'rent_payments', singular: 'Rent payment', plural: 'Rent payments', kind: 'ledger', icon: 'Banknote',
        fields: [money('amount', 'Amount', { required: true, min: 0.01 }), { id: 'paid_on', label: 'Paid on', type: 'date', required: true }, { id: 'allocated', label: 'Allocated', type: 'yesNo', defaultValue: { kind: 'value', value: false } }, { id: 'reference', label: 'Reference', type: 'shortText', required: true, unique: true }],
      },
    ],
    relationships: [
      rel('landlord', 'Landlord', 'properties', 'landlords', { required: true, reverseLabel: 'Properties' }),
      rel('property', 'Property', 'enquiries', 'properties', { required: true, reverseLabel: 'Enquiries' }),
      rel('property', 'Property', 'tenancies', 'properties', { required: true, reverseLabel: 'Tenancies' }),
      rel('tenant', 'Tenant', 'tenancies', 'tenants', { required: true, reverseLabel: 'Tenancies' }),
      rel('tenancy', 'Tenancy', 'rent_payments', 'tenancies', { required: true, reverseLabel: 'Payments' }),
      rel('property', 'Property', 'rent_payments', 'properties', { required: true, reverseLabel: 'Rent payments' }),
    ],
    pipelines: [
      {
        id: 'tenancy_stage', moduleId: 'tenancies', stageFieldLabel: 'Tenancy stage',
        stages: [{ id: 'active', label: 'Active' }, { id: 'notice', label: 'Notice given' }, { id: 'ended', label: 'Ended', requiredFieldIds: ['end_date'] }],
        transitions: [{ from: 'active', to: 'notice' }, { from: 'notice', to: 'ended' }, { from: 'notice', to: 'active' }],
        trackTimeInStage: true,
      },
    ],
    formulas: [
      {
        id: 'income_received', moduleId: 'properties', label: 'Rent income received', expression: 'SUM_REL(rent_payments, property, amount)', resultType: 'money', currency: 'GBP', ...base,
        description: 'Every rent payment recorded against this property, across all its tenancies',
        sources: [{ moduleId: 'rent_payments', fieldId: 'amount' }, { moduleId: 'rent_payments', fieldId: 'property' }],
        tests: [t('no payments', [], '0.00'), t('two payments', [rent(750.5), rent(750.5)], '1501.00'), t('float trap', [rent(0.1), rent(0.2)], '0.30')],
      },
      {
        id: 'enquiry_count', moduleId: 'properties', label: 'Enquiries', expression: 'COUNT_REL(enquiries, property)', resultType: 'integer', precision: 0, rounding: 'half_up', nullBehavior: 'zero', divByZero: 'null',
        sources: [{ moduleId: 'enquiries', fieldId: 'property' }],
        tests: [t('none', [], '0'), t('two enquiries', [enquiry(), enquiry()], '2')],
      },
      {
        id: 'active_tenancies', moduleId: 'properties', label: 'Active tenancies', expression: 'COUNT_REL(tenancies, property, {tenancy_stage} == "active")', resultType: 'integer', precision: 0, rounding: 'half_up', nullBehavior: 'zero', divByZero: 'null',
        sources: [{ moduleId: 'tenancies', fieldId: 'property' }, { moduleId: 'tenancies', fieldId: 'tenancy_stage' }],
        tests: [t('none', [], '0'), t('one active one ended', [tenancy('active'), tenancy('ended')], '1')],
      },
      {
        id: 'paid_to_date', moduleId: 'tenancies', label: 'Paid to date', expression: 'SUM_REL(rent_payments, tenancy, amount)', resultType: 'money', currency: 'GBP', ...base,
        sources: [{ moduleId: 'rent_payments', fieldId: 'amount' }, { moduleId: 'rent_payments', fieldId: 'tenancy' }],
        tests: [t('no payments', [], '0.00'), t('two payments', [paidOn(500), paidOn(250.25)], '750.25'), t('one payment', [paidOn(10)], '10.00')],
      },
    ],
    forms: [{ id: 'record_rent', moduleId: 'rent_payments', name: 'Record rent', submitLabel: 'Record', sections: [{ id: 'main', title: 'Rent', columns: 2, fieldIds: ['tenancy', 'property', 'amount', 'paid_on', 'reference'] }] }],
    layouts: [],
    views: [{ id: 'enquiries_table', moduleId: 'enquiries', name: 'All enquiries', type: 'table', filters: [], sorts: [{ fieldId: 'name', dir: 'asc' }] }],
    workflows: [
      {
        id: 'rent_received', moduleId: 'rent_payments', name: 'Mark new rent payments as allocated',
        description: 'Property income is a live total of the payments, so it updates by itself; this also ticks the payment as allocated.',
        trigger: { type: 'record_created' }, conditions: [],
        actions: [{ id: 'a1', type: 'update_record', fieldId: 'allocated', value: true }, { id: 'a2', type: 'notify', message: 'Rent received: {{amount}}' }],
      },
      {
        id: 'tenancy_ending', moduleId: 'tenancies', name: 'Follow up 30 days before a tenancy ends',
        trigger: { type: 'date_reached', fieldId: 'end_date', offsetDays: -30 }, conditions: [],
        actions: [{ id: 'a1', type: 'create_followup', title: 'Renewal or notice for tenancy {{title}}', days: 0 }],
      },
    ],
    dashboards: [
      {
        id: 'lettings_overview', name: 'Lettings overview',
        components: [
          { id: 'rent_in', title: 'Rent received', type: 'stat', moduleId: 'rent_payments', agg: 'sum', fieldId: 'amount', dateRange: 'all', filters: [], w: 1, h: 1, definition: 'Sum of all rent payments recorded', refresh: 'live' },
          { id: 'enq_by_prop', title: 'Enquiries', type: 'stat', moduleId: 'enquiries', agg: 'count', dateRange: 'all', filters: [], w: 1, h: 1, definition: 'Number of enquiries', refresh: 'live' },
        ],
      },
    ],
    permissions: [
      { roleId: 'negotiator', moduleId: 'rent_payments', access: { view: false, create: false, edit: false, delete: false } },
      { roleId: 'negotiator', moduleId: 'tenancies', access: { view: true, create: false, edit: false, delete: false }, fieldAccess: [{ fieldId: 'paid_to_date', access: 'hidden' }, { fieldId: 'rent', access: 'hidden' }] },
      { roleId: 'negotiator', moduleId: 'properties', access: { view: true, create: false, edit: false, delete: false }, fieldAccess: [{ fieldId: 'income_received', access: 'hidden' }] },
    ],
  }
}
