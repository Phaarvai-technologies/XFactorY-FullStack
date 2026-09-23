/** Clerk theme aligned with the X!Y sign-in reference (SCR-02). */
export const clerkAuthAppearance = {
  variables: {
    colorPrimary: "#1E4FD6",
    colorText: "#0F1E3D",
    colorTextSecondary: "#5B6B85",
    colorBackground: "#FFFFFF",
    colorInputBackground: "#FFFFFF",
    colorInputText: "#0F1E3D",
    borderRadius: "8px",
    fontFamily: "var(--font-inter), 'IBM Plex Sans', sans-serif",
    fontFamilyButtons: "var(--font-inter), 'IBM Plex Sans', sans-serif",
  },
  elements: {
    rootBox: "w-full",
    cardBox: "shadow-none w-full max-w-none",
    card: "shadow-none border-0 p-0 bg-transparent gap-0",
    header: "hidden",
    headerTitle: "hidden",
    headerSubtitle: "hidden",
    socialButtonsBlockButton:
      "border border-[#DCE6F5] rounded-lg text-[#0F1E3D] font-semibold text-sm hover:bg-[#F2F6FD]",
    socialButtonsBlockButtonText: "font-semibold",
    dividerLine: "bg-[#DCE6F5]",
    dividerText: "text-[#8C9BB8] text-xs",
    formFieldLabel: "text-[#0F1E3D] text-sm font-semibold",
    formFieldInput:
      "border border-[#DCE6F5] rounded-lg text-[#0F1E3D] focus:border-[#1E4FD6] focus:ring-[3px] focus:ring-[rgba(30,79,214,0.12)]",
    formButtonPrimary:
      "bg-[#1E4FD6] hover:bg-[#163CAE] rounded-lg text-white font-semibold text-[15px] py-3 shadow-none",
    footerAction: "hidden",
    footer: "hidden",
    identityPreview: "border border-[#DCE6F5] rounded-lg",
    formFieldAction: "text-[#2D6CDF] font-semibold",
    alert: "rounded-lg",
  },
};
