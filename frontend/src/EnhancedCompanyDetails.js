import React, { useState } from "react";

/**
 * EnhancedCompanyDetails component
 *
 * This component demonstrates a modern two‑column layout for the company details view.
 * The left column contains a filterable corporate hierarchy tree, while the right
 * column displays the company’s key information in separate panels.  It uses
 * Tailwind CSS classes for styling and can be customized further.  See the
 * accompanying design notes for rationale based on UX research, including the
 * importance of search in hierarchical views【223048328786256†L68-L70】 and the
 * principles of visual hierarchy (size, color, typography, spacing)【953073799556644†L62-L82】【953073799556644†L84-L97】.
 */
const EnhancedCompanyDetails = ({
  selectedCompany,
  hierarchyData,
  loadingHierarchy,
  navigateToCompany,
  exportHierarchyToExcel,
  showDownwardFamilyTree,
  setShowDownwardFamilyTree,
  navigationHistory,
  navigateBack,
  backToResults,
}) => {
  const [treeSearchTerm, setTreeSearchTerm] = useState("");
  const hierarchy = hierarchyData?.hierarchy || selectedCompany?.corporate_hierarchy;

  // Filter hierarchy members based on the search term
  const filteredFamilyMembers = (hierarchy?.familyTreeMembers || []).filter((member) => {
    const term = treeSearchTerm.trim().toLowerCase();
    if (!term) return true;
    return (
      (member.primaryName || "").toLowerCase().includes(term) ||
      (member.duns || "").toLowerCase().includes(term)
    );
  });

  return (
    <div className="py-8">
      {/* Header with back button */}
      <div className="flex justify-between items-center mb-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Company Details</h2>
          <p className="text-sm text-gray-600">{selectedCompany?.company_name}</p>
        </div>
        <button
          onClick={backToResults}
          className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 transition-colors"
        >
          ← Back to Results
        </button>
      </div>

      {/* Main layout: two columns on large screens */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left column: hierarchy and actions */}
        <aside className="lg:col-span-1 space-y-6">
          {/* Export and view toggles */}
          <div className="flex flex-col space-y-2">
            <button
              onClick={exportHierarchyToExcel}
              className="inline-flex items-center justify-center px-3 py-2 bg-green-600 text-white text-sm font-medium rounded-md hover:bg-green-700 transition-colors"
              title="Export to Excel"
              disabled={!hierarchy}
            >
              <svg
                className="w-4 h-4 mr-1"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                />
              </svg>
              Export
            </button>
            <button
              onClick={() => setShowDownwardFamilyTree(!showDownwardFamilyTree)}
              className="inline-flex items-center justify-center px-3 py-2 bg-indigo-600 text-white text-sm font-medium rounded-md hover:bg-indigo-700 transition-colors"
              disabled={!hierarchy}
            >
              {showDownwardFamilyTree ? "Hierarchy View" : "Downward Tree"}
            </button>
          </div>

          {/* Hierarchy panel */}
          <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-4 overflow-hidden">
            <h3 className="font-semibold text-indigo-700 mb-3 flex items-center">
              <svg
                className="w-5 h-5 mr-1"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M16 9l-4-4-4 4m8 6l-4 4-4-4"
                />
              </svg>
              Corporate Hierarchy
            </h3>
            <input
              type="text"
              value={treeSearchTerm}
              onChange={(e) => setTreeSearchTerm(e.target.value)}
              placeholder="Search in hierarchy..."
              className="w-full mb-3 px-3 py-2 border border-indigo-200 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-sm"
            />
            {loadingHierarchy ? (
              <div className="flex items-center justify-center py-4">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-indigo-600"></div>
                <span className="ml-2 text-sm text-gray-600">Loading hierarchy...</span>
              </div>
            ) : showDownwardFamilyTree ? (
              /* Downward tree view */
              <div className="space-y-2 max-h-72 overflow-y-auto">
                {filteredFamilyMembers.filter((m) => m.hierarchyLevel >= 2 && m.relationshipCode === "SUB").map((member, idx) => (
                  <div
                    key={idx}
                    className="flex justify-between items-center py-2 px-2 bg-purple-50 border border-purple-200 rounded-md hover:bg-purple-100 cursor-pointer"
                    onClick={() => navigateToCompany(member.duns, member.primaryName)}
                  >
                    <div>
                      <p className="font-medium text-purple-800">{member.primaryName}</p>
                      <p className="text-xs text-purple-600">DUNS: {member.duns}</p>
                    </div>
                    <svg
                      className="w-4 h-4 text-purple-400"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M9 5l7 7-7 7"
                      />
                    </svg>
                  </div>
                ))}
                {filteredFamilyMembers.filter((m) => m.hierarchyLevel >= 2 && m.relationshipCode === "SUB").length === 0 && (
                  <div className="text-center text-sm text-gray-500 py-4">No subsidiaries found</div>
                )}
              </div>
            ) : (
              /* Regular family tree view */
              <div className="space-y-2 max-h-72 overflow-y-auto">
                {filteredFamilyMembers.map((member, idx) => (
                  <div
                    key={idx}
                    className="flex justify-between items-center py-2 px-2 border-b last:border-b-0 hover:bg-gray-100 cursor-pointer"
                    onClick={() => navigateToCompany(member.duns, member.primaryName)}
                  >
                    <div>
                      <p className="font-medium text-gray-800">{member.primaryName}</p>
                      <p className="text-xs text-gray-600">DUNS: {member.duns}</p>
                      {member.hierarchyLevel !== undefined && (
                        <span className="inline-block mt-1 px-2 py-0.5 bg-gray-200 text-gray-700 text-xs rounded">
                          Level: {member.hierarchyLevel}
                        </span>
                      )}
                    </div>
                    <svg
                      className="w-4 h-4 text-gray-400"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M9 5l7 7-7 7"
                      />
                    </svg>
                  </div>
                ))}
                {filteredFamilyMembers.length === 0 && (
                  <div className="text-center text-sm text-gray-500 py-4">No matching members</div>
                )}
              </div>
            )}
            {hierarchy && !loadingHierarchy && (
              <p className="mt-4 text-xs text-gray-500 text-center">Source: {hierarchyData?.data_source || "D&B API"}</p>
            )}
          </div>
        </aside>

        {/* Right column: details */}
        <section className="lg:col-span-2 space-y-6">
          {/* Identification & Status */}
          <div className="bg-white rounded-lg shadow p-4">
            <h4 className="font-semibold text-gray-900 mb-3">Identification & Status</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 text-sm text-gray-700">
              <div>
                <span className="block font-medium text-gray-500">D-U-N-S®</span>
                <span className="font-mono text-blue-600 text-base">{selectedCompany?.duns || "N/A"}</span>
              </div>
              <div>
                <span className="block font-medium text-gray-500">Legal Name</span>
                <span>{selectedCompany?.legal_name || "N/A"}</span>
              </div>
              <div>
                <span className="block font-medium text-gray-500">Operating Status</span>
                <span className={
                  selectedCompany?.operating_status?.toLowerCase().includes("active")
                    ? "text-green-600"
                    : "text-red-600"
                }>
                  {selectedCompany?.operating_status || "N/A"}
                </span>
              </div>
            </div>
          </div>

          {/* Address & Location */}
          <div className="bg-white rounded-lg shadow p-4">
            <h4 className="font-semibold text-gray-900 mb-3">Address & Location</h4>
            <div className="space-y-1 text-sm text-gray-700">
              {selectedCompany?.address?.street && (
                <div>
                  <span className="font-medium text-gray-500">Street: </span>
                  {selectedCompany.address.street}
                </div>
              )}
              {selectedCompany?.address?.postal_code && (
                <div>
                  <span className="font-medium text-gray-500">Postal Code: </span>
                  {selectedCompany.address.postal_code}
                </div>
              )}
              {selectedCompany?.address?.city && (
                <div>
                  <span className="font-medium text-gray-500">City: </span>
                  {selectedCompany.address.city}
                </div>
              )}
              {selectedCompany?.address?.state && (
                <div>
                  <span className="font-medium text-gray-500">State: </span>
                  {selectedCompany.address.state}
                </div>
              )}
              {selectedCompany?.address?.country && (
                <div>
                  <span className="font-medium text-gray-500">Country: </span>
                  {selectedCompany.address.country}
                </div>
              )}
              {selectedCompany?.address?.latitude && selectedCompany?.address?.longitude && (
                <div className="text-xs text-gray-500">
                  <span className="font-medium">Coordinates: </span>
                  {selectedCompany.address.latitude}, {selectedCompany.address.longitude}
                </div>
              )}
            </div>
          </div>

          {/* Contact & Communication */}
          <div className="bg-white rounded-lg shadow p-4">
            <h4 className="font-semibold text-gray-900 mb-3">Contact & Communication</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 text-sm text-gray-700">
              {selectedCompany?.phone && (
                <div>
                  <span className="block font-medium text-gray-500">Phone</span>
                  <span className="font-mono text-orange-600">{selectedCompany.phone}</span>
                </div>
              )}
              {selectedCompany?.fax && (
                <div>
                  <span className="block font-medium text-gray-500">Fax</span>
                  <span className="font-mono text-orange-600">{selectedCompany.fax}</span>
                </div>
              )}
              {selectedCompany?.website && (
                <div>
                  <span className="block font-medium text-gray-500">Website</span>
                  <a
                    href={selectedCompany.website}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:text-blue-800 underline"
                  >
                    {selectedCompany.website}
                  </a>
                </div>
              )}
              {selectedCompany?.email && (
                <div>
                  <span className="block font-medium text-gray-500">Email</span>
                  <a
                    href={`mailto:${selectedCompany.email}`}
                    className="text-blue-600 hover:text-blue-800 underline"
                  >
                    {selectedCompany.email}
                  </a>
                </div>
              )}
            </div>
          </div>
        </section>
      </div>

      {/* Metadata footer */}
      <div className="mt-8 pt-4 border-t border-gray-200 text-xs text-gray-500 flex justify-between">
        <p>Last Updated: {selectedCompany?.last_updated ? new Date(selectedCompany.last_updated).toLocaleString("fr-FR") : "N/A"}</p>
        <p>Source: {selectedCompany?.data_source || "D&B API"}</p>
      </div>
    </div>
  );
};

export default EnhancedCompanyDetails;
