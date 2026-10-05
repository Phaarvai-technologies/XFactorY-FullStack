/**
 * Public manufacturer profile shown to Visionaries ("Manufacturer Profile" page).
 * Built by the backend from the manufacturer's saved data
 * (GET /visionary/manufacturers/{id} -> profile): public fields only, never contact
 * details, owner details or the street address.
 */
export type PublicMachine = {
  name: string;
  type: string;
  image: string | null;
  capacity: string;
  quantity: string;
  availability: string;
  specifications: string;
  industry: string;
};

export type PublicCertification = {
  name: string;
  body: string;
  status: string;
};

export type PublicManufacturerProfile = {
  id: string;
  name: string;
  logo: string | null;
  about: string;
  companyType: string;
  industry: string;
  established: string;
  companySize: string;
  location: string;
  address: string;
  processes: string[];
  products: string[];
  industries: string[];
  materials: string[];
  machines: PublicMachine[];
  capacityText: string;
  availability: string;
  availabilityNote: string;
  certifications: PublicCertification[];
  verified: boolean;
};
