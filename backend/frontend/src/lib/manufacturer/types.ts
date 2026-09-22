/** Shared state model for the Manufacturer website (converted from the uploaded HTML demo). */

export type Certification = {
  name: string;
  body: string;
  fileName: string;
  status: "Pending" | "Verified" | "Rejected";
};

export type FaqEntry = {
  q: string;
  a: string;
};

export type MachineryImage = {
  src: string;
  primary: boolean;
};

export type MachineryListing = {
  id: number;
  industry: string;
  subcategory: string;
  type: string;
  capacity: string;
  age: string;
  condition: string;
  technical: string;
  images: MachineryImage[];
  rawMatStatus: string;
  materialDetails: string;
  laborType: string;
  workerCount: string;
  workerRoles: string;
  logistics: string[];
  logisticsPartner: string;
  pricing: {
    hour: string;
    day: string;
    month: string;
    unit: string;
    batch: string;
  };
  insurance: string;
  status: "Draft" | "Published" | "Unpublished" | "Archived";
};

export type RecurringAvailability = {
  days: string[];
  start: string;
  end: string;
};

export type CapacityPlan = {
  machine: string;
  count: string;
  start: string;
  end: string;
};

export type BookingRequest = {
  id: number;
  buyer: string;
  item: string;
  date: string;
  status: "New" | "Reserved" | "Booked" | "Cancelled";
};

/** Checklist keys driving the profile-completion progress (Epic 2). */
export type ProfileChecklistKey =
  | "companyDetailsDone"
  | "locationDone"
  | "certsDone"
  | "infraDone"
  | "faqDone";

export type ManufacturerState = {
  account: {
    firstName: string;
    lastName: string;
    companyName: string;
    companyType: string;
    country: string;
    dob: string;
    phone: string;
    capacity: string;
  };
  contact: {
    email: string;
    phone: string;
  };
  epic2: {
    companyDetailsDone: boolean;
    locationDone: boolean;
    certifications: Certification[];
    infraDone: boolean;
    faqs: FaqEntry[];
  };
  serviceableAreas: string[];
  machinery: MachineryListing[];
  calendar: Record<string, "available" | "blocked">;
  recurring: RecurringAvailability | null;
  capacity: CapacityPlan | null;
  bookings: BookingRequest[];
};

export const INITIAL_BOOKINGS: BookingRequest[] = [
  { id: 1, buyer: "Orion Textiles", item: "CNC Machining — batch run", date: "Sep 20, 2026", status: "New" },
  { id: 2, buyer: "BluePeak Foods", item: "Cold storage — 2 weeks", date: "Sep 25, 2026", status: "Reserved" },
  { id: 3, buyer: "Vertex Auto Parts", item: "Injection molding line", date: "Oct 2, 2026", status: "Booked" },
  { id: 4, buyer: "Nimbus Packaging", item: "Warehouse space — 500 sq ft", date: "Sep 18, 2026", status: "Cancelled" },
];

export function createInitialManufacturerState(): ManufacturerState {
  return {
    account: {
      firstName: "",
      lastName: "",
      companyName: "",
      companyType: "",
      country: "",
      dob: "",
      phone: "",
      capacity: "",
    },
    contact: { email: "", phone: "" },
    epic2: {
      companyDetailsDone: false,
      locationDone: false,
      certifications: [],
      infraDone: false,
      faqs: [],
    },
    serviceableAreas: [],
    machinery: [],
    calendar: {},
    recurring: null,
    capacity: null,
    bookings: INITIAL_BOOKINGS.map((booking) => ({ ...booking })),
  };
}

export function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function isValidPhone(value: string): boolean {
  return /^\d{10}$/.test(value);
}
