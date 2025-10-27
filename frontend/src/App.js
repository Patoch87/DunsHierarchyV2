import React, { useState, useEffect } from "react";
import "./App.css";
import axios from "axios";
import Login from "./Login";
import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

function App() {
  // États pour l'authentification
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [username, setUsername] = useState('');
  const [authLoading, setAuthLoading] = useState(true);

  // États pour les critères de recherche GRS D&B
  const [searchCriteria, setSearchCriteria] = useState({
    // Identification
    duns: "",                    // Numéro D-U-N-S®
    local_identifier: "",        // Identifiant local
    company_name: "",            // Raison sociale
    
    // Adresse
    address: "",                 // Adresse
    city: "",                    // Ville
    postal_code: "",             // Code postal
    state: "",                   // État
    country: "",                 // Pays/Région
    continent: "",               // Continent
    
    // Contact
    phone_fax: "",               // Téléphone/Fax
    has_phone: false,            // Téléphone présent
    has_fax: false,              // Fax présent
    
    // Options de recherche
    exact_match: false           // Correspondance exacte sur le nom
  });
  
  const [searchResults, setSearchResults] = useState([]);
  const [selectedCompany, setSelectedCompany] = useState(null);
  const [cachedCompanies, setCachedCompanies] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [hierarchyData, setHierarchyData] = useState(null);
  const [loadingHierarchy, setLoadingHierarchy] = useState(false);
  const [showDownwardFamilyTree, setShowDownwardFamilyTree] = useState(false);
  const [showStrategiesModal, setShowStrategiesModal] = useState(false);
  // Plus de navigation par pages - tout sur une seule page

  // Navigation dans la hiérarchie
  const [navigationHistory, setNavigationHistory] = useState([]);
  
  // Navigation entre pages
  const [currentPage, setCurrentPage] = useState('search'); // 'search' or 'details'

  const navigateToCompany = async (duns, companyName) => {
    if (!duns) return;
    
    try {
      setLoading(true);
      
      // Ajouter à l'historique de navigation
      const currentView = {
        company: selectedCompany,
        hierarchyData: hierarchyData,
        timestamp: Date.now()
      };
      setNavigationHistory([...navigationHistory, currentView]);
      
      // Rechercher la nouvelle entreprise par DUNS
      const searchResult = await handleUnifiedSearch({ duns });
      
      if (searchResult && searchResult.length > 0) {
        await handleSelectCompany(searchResult[0]);
      } else {
        // Si pas trouvé dans les résultats, essayer la recherche directe
        const token = localStorage.getItem('token');
        const response = await fetch(`${import.meta.env.REACT_APP_BACKEND_URL}/api/unified-search`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({ duns })
        });
        
        if (response.ok) {
          const results = await response.json();
          if (results && results.length > 0) {
            await handleSelectCompany(results[0]);
          } else {
            setError(`Aucune information trouvée pour ${companyName || `DUNS ${duns}`}`);
          }
        }
      }
    } catch (err) {
      console.error('Error navigating to company:', err);
      setError(`Erreur lors de la navigation vers ${companyName || `DUNS ${duns}`}`);
    } finally {
      setLoading(false);
    }
  };

  const navigateToDetails = (company) => {
    setSelectedCompany(company);
    setCurrentPage('details');
    setHierarchyData(null);
    setShowDownwardFamilyTree(false);
    
    // Fetch hierarchy data if we have a DUNS
    if (company.duns) {
      fetchHierarchyData(company.duns);
    }
  };

  const backToResults = () => {
    setCurrentPage('results');
    setSelectedCompany(null);
    setHierarchyData(null);
    setShowDownwardFamilyTree(false);
  };

  const navigateBack = () => {
    if (navigationHistory.length > 0) {
      const previousView = navigationHistory[navigationHistory.length - 1];
      setSelectedCompany(previousView.company);
      setHierarchyData(previousView.hierarchyData);
      setNavigationHistory(navigationHistory.slice(0, -1));
      setShowDownwardFamilyTree(false);
    }
  };

  // Fonction d'export Excel de la hiérarchie
  const exportHierarchyToExcel = () => {
    console.log("🚀 Export Excel clicked!");
    
    if (!selectedCompany) {
      console.error("❌ No selected company");
      alert("Aucune entreprise sélectionnée");
      return;
    }
    
    console.log("✅ Selected company:", selectedCompany.company_name);
    
    const hierarchy = hierarchyData?.hierarchy || selectedCompany?.corporate_hierarchy;
    if (!hierarchy) {
      console.error("❌ No hierarchy data available");
      alert("No hierarchy information available");
      return;
    }
    
    console.log("✅ Hierarchy data found:", hierarchy);

    try {
      // Création des données pour Excel avec structure navigable
      const exportData = [];

      // En-tête principal - Company actuelle
      exportData.push({
        'Level': 0,
        'Expand': '+',
        'Entity Type': 'Current Company',
        'D-U-N-S': selectedCompany.duns || '',
        'Name': selectedCompany.company_name || '',
        'Legal Name': selectedCompany.legal_name || '',
        'Operating Status': selectedCompany.operating_status || '',
        'Address': selectedCompany.address ? 
          `${selectedCompany.address.street || ''}, ${selectedCompany.address.city || ''}, ${selectedCompany.address.country || ''}`.replace(/^,\s*|,\s*$/g, '') : '',
        'Phone': selectedCompany.phone || '',
        'Email': selectedCompany.email || '',
        'Website': selectedCompany.website || '',
        'Industry': selectedCompany.industry || '',
        'Employee Count': selectedCompany.employee_count || '',
        'Sales Volume': selectedCompany.sales_volume || '',
        'Year Started': selectedCompany.year_started || '',
        'Legal Form': selectedCompany.legal_form || '',
        'National IDs': selectedCompany.registration_numbers ? 
          selectedCompany.registration_numbers.map(reg => `${reg.type}: ${reg.number}`).join('; ') : '',
        'Relationship': 'Current Entity',
        'Relationship Description': 'Selected Company'
      });

      // Global Ultimate (Level -1 - Upward)
      if (hierarchy.globalUltimate && hierarchy.globalUltimate.duns !== selectedCompany.duns) {
        exportData.push({
          'Level': -1,
          'Expand': '+',
          'Entity Type': 'Global Ultimate',
          'D-U-N-S': hierarchy.globalUltimate.duns || '',
          'Name': hierarchy.globalUltimate.primaryName || '',
          'Legal Name': hierarchy.globalUltimate.legalName || '',
          'Operating Status': hierarchy.globalUltimate.operatingStatus || '',
          'Address': hierarchy.globalUltimate.address ? 
            `${hierarchy.globalUltimate.address.street || ''}, ${hierarchy.globalUltimate.address.city || ''}, ${hierarchy.globalUltimate.address.country || ''}`.replace(/^,\s*|,\s*$/g, '') : '',
          'Phone': hierarchy.globalUltimate.phone || '',
          'Email': hierarchy.globalUltimate.email || '',
          'Website': hierarchy.globalUltimate.website || '',
          'Industry': '',
          'Employee Count': '',
          'Sales Volume': '',
          'Year Started': '',
          'Legal Form': '',
          'National IDs': '',
          'Relationship': 'GUP',
          'Relationship Description': 'Global Ultimate Parent'
        });
      }

      // Domestic Ultimate (Level -1 - Upward) 
      if (hierarchy.domesticUltimate && 
          hierarchy.domesticUltimate.duns !== selectedCompany.duns && 
          hierarchy.domesticUltimate.duns !== hierarchy.globalUltimate?.duns) {
        exportData.push({
          'Level': -1,
          'Expand': '+',
          'Entity Type': 'Domestic Ultimate', 
          'D-U-N-S': hierarchy.domesticUltimate.duns || '',
          'Name': hierarchy.domesticUltimate.primaryName || '',
          'Legal Name': hierarchy.domesticUltimate.legalName || '',
          'Operating Status': hierarchy.domesticUltimate.operatingStatus || '',
          'Address': hierarchy.domesticUltimate.address ? 
            `${hierarchy.domesticUltimate.address.street || ''}, ${hierarchy.domesticUltimate.address.city || ''}, ${hierarchy.domesticUltimate.address.country || ''}`.replace(/^,\s*|,\s*$/g, '') : '',
          'Phone': hierarchy.domesticUltimate.phone || '',
          'Email': hierarchy.domesticUltimate.email || '',
          'Website': hierarchy.domesticUltimate.website || '',
          'Industry': '',
          'Employee Count': '',
          'Sales Volume': '',
          'Year Started': '',
          'Legal Form': '',
          'National IDs': '',
          'Relationship': 'DUP',
          'Relationship Description': 'Domestic Ultimate Parent'
        });
      }

      // Parent Direct (Level -1 - Upward)
      if (hierarchy.parent && 
          hierarchy.parent.duns !== selectedCompany.duns && 
          hierarchy.parent.duns !== hierarchy.globalUltimate?.duns &&
          hierarchy.parent.duns !== hierarchy.domesticUltimate?.duns) {
        exportData.push({
          'Level': -1,
          'Expand': '+',
          'Entity Type': 'Parent Direct',
          'D-U-N-S': hierarchy.parent.duns || '',
          'Name': hierarchy.parent.primaryName || '',
          'Legal Name': hierarchy.parent.legalName || '',
          'Operating Status': hierarchy.parent.operatingStatus || '',
          'Address': hierarchy.parent.address ? 
            `${hierarchy.parent.address.street || ''}, ${hierarchy.parent.address.city || ''}, ${hierarchy.parent.address.country || ''}`.replace(/^,\s*|,\s*$/g, '') : '',
          'Phone': hierarchy.parent.phone || '',
          'Email': hierarchy.parent.email || '',
          'Website': hierarchy.parent.website || '',
          'Industry': '',
          'Employee Count': '',
          'Sales Volume': '',
          'Year Started': '',
          'Legal Form': '',
          'National IDs': '',
          'Relationship': hierarchy.parent.relationshipCode || 'PAR',
          'Relationship Description': hierarchy.parent.relationshipDescription || 'Parent Direct'
        });
      }

      // Subsidiaries (Level +1 - Downward)
      if (hierarchy.subsidiaries && hierarchy.subsidiaries.length > 0) {
        hierarchy.subsidiaries.forEach((subsidiary, index) => {
          exportData.push({
            'Level': subsidiary.hierarchyLevel || 1,
            'Expand': '+',
            'Entity Type': 'Subsidiary',
            'D-U-N-S': subsidiary.duns || '',
            'Name': subsidiary.primaryName || '',
            'Legal Name': subsidiary.legalName || '',
            'Operating Status': subsidiary.operatingStatus || '',
            'Address': subsidiary.address ? 
              `${subsidiary.address.street || ''}, ${subsidiary.address.city || ''}, ${subsidiary.address.country || ''}`.replace(/^,\s*|,\s*$/g, '') : '',
            'Phone': subsidiary.phone || '',
            'Email': subsidiary.email || '',
            'Website': subsidiary.website || '',
            'Industry': subsidiary.industry || '',
            'Employee Count': subsidiary.employeeCount || '',
            'Sales Volume': subsidiary.salesVolume || '',
            'Year Started': subsidiary.yearStarted || '',
            'Legal Form': subsidiary.legalForm || '',
            'National IDs': subsidiary.nationalIds || '',
            'Relationship': subsidiary.relationshipCode || 'SUB',
            'Relationship Description': subsidiary.relationshipDescription || 'Wholly Owned Subsidiary'
          });
        });
      }

      // Family Tree Members (tous les niveaux)
      if (hierarchy.familyTreeMembers && hierarchy.familyTreeMembers.length > 0) {
        hierarchy.familyTreeMembers.forEach((member, index) => {
          // Éviter les doublons
          const exists = exportData.some(row => row['D-U-N-S'] === member.duns);
          if (!exists) {
            exportData.push({
              'Level': member.hierarchyLevel || 0,
              'Expand': '+',
              'Entity Type': 'Family Tree Member',
              'D-U-N-S': member.duns || '',
              'Name': member.primaryName || '',
              'Legal Name': member.legalName || '',
              'Operating Status': member.operatingStatus || '',
              'Address': member.address ? 
                `${member.address.street || ''}, ${member.address.city || ''}, ${member.address.country || ''}`.replace(/^,\s*|,\s*$/g, '') : '',
              'Phone': member.phone || '',
              'Email': member.email || '',
              'Website': member.website || '',
              'Industry': member.industry || '',
              'Employee Count': member.employeeCount || '',
              'Sales Volume': member.salesVolume || '',
              'Year Started': member.yearStarted || '',
              'Legal Form': member.legalForm || '',
              'National IDs': member.nationalIds || '',
              'Relationship': member.relationshipCode || '',
              'Relationship Description': member.relationshipDescription || ''
            });
          }
        });
      }

      console.log("📊 Export data prepared:", exportData.length, "entities");

      // Trier par niveau pour avoir une structure logique
      exportData.sort((a, b) => (a.Level || 0) - (b.Level || 0));

      // Vérification des dépendances XLSX
      if (!XLSX || !XLSX.utils || !XLSX.utils.book_new) {
        console.error("❌ XLSX library not loaded properly");
        alert("Erreur: Bibliothèque Excel non chargée. Actualisez la page.");
        return;
      }

      // Création du classeur Excel
      const workbook = XLSX.utils.book_new();

      // Feuille principale avec hiérarchie
      const worksheet = XLSX.utils.json_to_sheet(exportData);

      // Définir les largeurs des colonnes
      const columnWidths = [
        { wch: 8 },   // Level
        { wch: 8 },   // Expand  
        { wch: 15 },  // Entity Type
        { wch: 12 },  // D-U-N-S
        { wch: 30 },  // Name
        { wch: 30 },  // Legal Name
        { wch: 15 },  // Operating Status
        { wch: 40 },  // Address
        { wch: 15 },  // Phone
        { wch: 25 },  // Email
        { wch: 25 },  // Website
        { wch: 20 },  // Industry
        { wch: 15 },  // Employee Count
        { wch: 15 },  // Sales Volume
        { wch: 12 },  // Year Started
        { wch: 15 },  // Legal Form
        { wch: 30 },  // National IDs
        { wch: 12 },  // Relationship
        { wch: 25 }   // Relationship Description
      ];

      worksheet['!cols'] = columnWidths;

      // Ajouter la feuille au classeur
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Corporate Hierarchy');

      // Feuille de métadonnées
      const metadataSheet = XLSX.utils.json_to_sheet([
        { Property: 'Company Name', Value: selectedCompany.company_name || '' },
        { Property: 'D-U-N-S Number', Value: selectedCompany.duns || '' },
        { Property: 'Export Date', Value: new Date().toLocaleString() },
        { Property: 'Total Entities', Value: exportData.length },
        { Property: 'Data Source', Value: hierarchyData?.data_source || selectedCompany.data_source || 'D&B API' },
        { Property: 'Language', Value: language },
        { Property: 'Instructions', Value: 'Use Level column to understand hierarchy. Negative levels = upward (parents), Positive levels = downward (subsidiaries)' }
      ]);

      XLSX.utils.book_append_sheet(workbook, metadataSheet, 'Metadata');

      console.log("📋 Excel workbook created successfully");

      // Générer et télécharger le fichier
      const excelBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
      const blob = new Blob([excelBuffer], { 
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;charset=UTF-8' 
      });
      
      const fileName = `Corporate_Hierarchy_${(selectedCompany.company_name || 'Company').replace(/[^a-zA-Z0-9]/g, '_')}_${selectedCompany.duns || 'Unknown'}_${new Date().toISOString().split('T')[0]}.xlsx`;
      
      console.log("💾 Downloading file:", fileName);
      
      // Vérification file-saver
      if (!saveAs) {
        console.error("❌ file-saver library not loaded");
        // Fallback: création d'un lien de téléchargement manuel
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        console.log("✅ Fallback download method used");
      } else {
        saveAs(blob, fileName);
        console.log("✅ File download initiated with file-saver");
      }

    } catch (error) {
      console.error("❌ Export Excel error:", error);
      alert(`Erreur lors de l'export: ${error.message}`);
    }
  };

  // Traductions

  // All text in English - no translation needed



  useEffect(() => {
    checkAuthentication();
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
      fetchCachedCompanies();
    }
  }, [isAuthenticated]);

  // Vérifier l'authentification au chargement
  const checkAuthentication = async () => {
    const token = localStorage.getItem('auth_token');
    const storedUsername = localStorage.getItem('username');
    
    if (token && storedUsername) {
      try {
        // Configurer axios avec le token
        axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;
        
        // Vérifier si le token est toujours valide
        await axios.get(`${API}/verify-token`);
        
        setIsAuthenticated(true);
        setUsername(storedUsername);
      } catch (error) {
        // Token invalide, nettoyer le localStorage
        localStorage.removeItem('auth_token');
        localStorage.removeItem('username');
        delete axios.defaults.headers.common['Authorization'];
      }
    }
    
    setAuthLoading(false);
  };

  // Fonction de connexion
  const handleLogin = (token, username) => {
    setIsAuthenticated(true);
    setUsername(username);
  };

  // Fonction de déconnexion
  const handleLogout = () => {
    localStorage.removeItem('auth_token');
    localStorage.removeItem('username');
    delete axios.defaults.headers.common['Authorization'];
    setIsAuthenticated(false);
    setUsername('');
    setSearchResults([]);
    setSelectedCompany(null);
  };

  const fetchCachedCompanies = async () => {
    try {
      const response = await axios.get(`${API}/cached-companies`);
      setCachedCompanies(response.data);
    } catch (error) {
      console.error("Error fetching cached companies:", error);
    }
  };

  const handleInputChange = (field, value) => {
    setSearchCriteria(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const handleUnifiedSearch = async () => {
    // Vérifier qu'au moins un critère est rempli
    const hasSearchCriteria = Object.entries(searchCriteria).some(([key, value]) => {
      if (typeof value === 'boolean') {
        return value; // Pour les checkboxes, vérifier si elles sont cochées
      }
      return value && value.toString().trim() !== "";
    });
    
    if (!hasSearchCriteria) {
      setError("Please fill in at least one search criterion");
      return;
    }

    setLoading(true);
    setError("");
    setSearchResults([]);
    setSelectedCompany(null);

    try {
      // Filtrer les critères vides et convertir les valeurs numériques
      const filteredCriteria = {};
      Object.entries(searchCriteria).forEach(([key, value]) => {
        if (typeof value === 'boolean') {
          if (value) {
            filteredCriteria[key] = value;
          }
        } else if (value && value.toString().trim() !== "") {
          // Pour les champs numériques, convertir en nombre
          if (['employee_count_min', 'employee_count_max', 'year_started_min', 'year_started_max'].includes(key)) {
            const numValue = parseInt(value, 10);
            if (!isNaN(numValue)) {
              filteredCriteria[key] = numValue;
            }
          } else {
            filteredCriteria[key] = value.toString().trim();
          }
        }
      });

      const response = await axios.post(`${API}/unified-search`, filteredCriteria);
      setSearchResults(response.data.results);
      
      if (response.data.results.length === 0) {
        setError("No companies found with these criteria");
      } else {
        fetchCachedCompanies(); // Refresh cached list
      }
    } catch (error) {
      if (error.response?.status === 400) {
        setError(error.response.data.detail);
      } else if (error.response?.status === 422) {
        // Gestion des erreurs de validation Pydantic
        const validationErrors = error.response.data.detail;
        if (Array.isArray(validationErrors)) {
          const errorMessages = validationErrors.map(err => 
            `${err.loc ? err.loc.join('.') : 'Field'}: ${err.msg}`
          ).join(', ');
          setError("Validation errors: " + errorMessages);
        } else {
          setError("Validation error: " + validationErrors);
        }
      } else {
        setError("Search error: " + (error.response?.data?.detail || error.message));
      }
    } finally {
      setLoading(false);
    }
    
    // Results will be displayed below the search form - no page change
  };

  const fetchHierarchyData = async (duns) => {
    if (!duns) return;
    
    setLoadingHierarchy(true);
    try {
      const response = await axios.get(`${API}/company-hierarchy/${duns}`);
      setHierarchyData(response.data);
    } catch (error) {
      console.error("Error fetching hierarchy data:", error);
      if (error.response?.status === 422) {
        console.error("Validation error for hierarchy:", error.response.data.detail);
      }
      setHierarchyData(null);
    } finally {
      setLoadingHierarchy(false);
    }
  };

  const handleSelectCompany = (company) => {
    setSelectedCompany(company);
    setHierarchyData(null); // Reset hierarchy data
    setShowDownwardFamilyTree(false); // Reset downward family tree view
    
    // Fetch hierarchy data if we have a DUNS
    if (company.duns) {
      fetchHierarchyData(company.duns);
    }
    
    setSearchCriteria({
      // Identification
      duns: company.duns || "",
      local_identifier: company.national_id || "",
      company_name: company.company_name || "",
      
      // Adresse
      address: company.address ? company.address.street || "" : "",
      city: company.address?.city || "",
      postal_code: company.address?.postal_code || "",
      state: company.address?.state || "",
      country: company.address?.country || "",
      continent: company.address?.continent || 
        (company.address?.country?.includes('United States') ? 'Amérique du Nord' :
         company.address?.country?.includes('France') ? 'Europe' :
         company.address?.country?.includes('Sweden') ? 'Europe' :
         company.address?.country?.includes('India') ? 'Asie' : ''),
      
      // Contact
      phone_fax: company.phone || "",
      has_phone: !!company.phone,
      has_fax: false
    });
  };

  const clearSearch = () => {
    setSearchCriteria({
      // Identification
      duns: "",
      local_identifier: "",
      company_name: "",
      
      // Adresse
      address: "",
      city: "",
      postal_code: "",
      state: "",
      country: "",
      continent: "",
      
      // Contact
      phone_fax: "",
      has_phone: false,
      has_fax: false
    });
    setSearchResults([]);
    setSelectedCompany(null);
    setError("");
  };

  const formatAddress = (address) => {
    if (!address) return "Non disponible";
    const parts = [address.street, address.city, address.state, address.postal_code, address.country]
      .filter(part => part && part.trim() !== "");
    return parts.length > 0 ? parts.join(", ") : "Non disponible";
  };

  const formatCurrency = (value) => {
    if (!value || value === "N/A") return "Non disponible";
    return value;
  };

  const getRankingBadge = (rankingInfo) => {
    if (!rankingInfo) return null;
    
    const { confidence_code, match_quality } = rankingInfo;
    
    let badgeColor = "bg-gray-100 text-gray-800";
    let icon = "⭐";
    
    if (confidence_code >= 9) {
      badgeColor = "bg-green-100 text-green-800";
      icon = "🏆";
    } else if (confidence_code >= 8) {
      badgeColor = "bg-blue-100 text-blue-800"; 
      icon = "⭐";
    } else if (confidence_code >= 6) {
      badgeColor = "bg-yellow-100 text-yellow-800";
      icon = "⚡";
    } else {
      badgeColor = "bg-gray-100 text-gray-800";
      icon = "📋";
    }
    
    return (
      <div className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${badgeColor} ml-2`}>
        <span className="mr-1">{icon}</span>
        Score: {confidence_code}/10
      </div>
    );
  };

  const getSearchCriteriaText = (criteria) => {
    if (!criteria) return "";
    const parts = [];
    Object.entries(criteria).forEach(([key, value]) => {
      if (value) {
        const labels = {
          // Identification
          duns: "DUNS",
          local_identifier: "Identifiant local",
          company_name: "Raison sociale",
          
          // Adresse
          address: "Adresse",
          city: "Ville",
          postal_code: "Code postal",
          state: "État",
          country: "Pays/Région",
          continent: "Continent",
          
          // Contact
          phone_fax: "Téléphone/Fax",
          has_phone: "Téléphone présent",
          has_fax: "Fax présent",
          
          // Compatibilité anciennes versions
          legal_name: "Nom légal",
          trade_name: "Nom commercial",
          street_address: "Rue",
          national_id: "ID National",
          phone: "Téléphone",
          website: "Website",
          email: "Email",
          industry: "Secteur",
          business_type: "Type d'entreprise",
          employee_count_min: "Employés min",
          employee_count_max: "Employés max",
          year_started_min: "Année min",
          year_started_max: "Année max",
          operating_status: "Statut",
          stock_exchange: "Bourse"
        };
        
        if (typeof value === 'boolean') {
          if (value) parts.push(`${labels[key] || key}: Oui`);
        } else {
          parts.push(`${labels[key] || key}: ${value}`);
        }
      }
    });
    return parts.slice(0, 3).join(", ") + (parts.length > 3 ? "..." : "");
  };

  // Si en cours de vérification d'authentification
  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Vérification de l'authentification...</p>
        </div>
      </div>
    );
  }

  // Si non authentifié, afficher la page de login
  if (!isAuthenticated) {
    return <Login onLogin={handleLogin} />;
  }

  // Si authentifié, afficher l'application principale
  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header avec informations utilisateur et logout */}
      <header className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center">
              <h1 className="text-xl font-semibold text-gray-900">
                {"Business Partner Search"}
              </h1>
            </div>
            <div className="flex items-center space-x-4">
              <div className="flex items-center text-sm text-gray-700">
                <svg className="h-4 w-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
                Connected as: <span className="font-medium ml-1">{username}</span>
              </div>
              
              <button
                onClick={handleLogout}
                className="inline-flex items-center px-3 py-2 border border-transparent text-sm leading-4 font-medium rounded-md text-white bg-red-600 hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500"
              >
                <svg className="h-4 w-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
                Déconnexion
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Contenu principal de l'application */}
      <main className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        {/* Navigation conditionnelle basée sur la page courante */}
        {currentPage === 'search' && (
          <>
            <div className="bg-white shadow-sm">
              <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <div className="flex justify-between items-center py-6">
                  <div className="flex items-center">
                    <div className="flex-shrink-0">
                      <h1 className="text-2xl font-bold text-gray-900">
                        {"Business Partner Search"}
                      </h1>
                    </div>
                  </div>
                  <div className="text-sm text-gray-500">
                    {"Using D&B API"} - Powered by D&B Direct Plus API
                  </div>
                </div>
              </div>
            </div>

            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
              {/* Navigation Tabs */}
              <div className="flex space-x-1 bg-gray-100 p-1 rounded-lg mb-8">
            <button
              onClick={() => setActiveTab("search")}
              className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-colors ${
                activeTab === "search"
                  ? "bg-white text-blue-700 shadow"
                  : "text-gray-500 hover:text-gray-700"
              }`}
            >
              {"Search"}
            </button>
            <button
              onClick={() => setActiveTab("cached")}
              className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-colors ${
                activeTab === "cached"
                  ? "bg-white text-blue-700 shadow"
                  : "text-gray-500 hover:text-gray-700"
              }`}
            >
              {"History"} ({cachedCompanies.length})
            </button>
          </div>

          {/* Simplified Search Form */}
          {activeTab === "search" && (
            <div className="bg-white rounded-lg shadow p-6 mb-8">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-lg font-medium text-gray-900">
                  {"Business Partner Search"}
                </h2>
                <button
                  onClick={clearSearch}
                  className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
                >
                  {"Clear"}
                </button>
              </div>
              
              {/* Section Identification */}
              <div className="mb-8">
                <h3 className="text-md font-medium text-gray-800 mb-4 pb-2 border-b border-gray-200">{"🆔 Identification"}</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      {"D-U-N-S® Number"}
                    </label>
                    <input
                      type="text"
                      value={searchCriteria.duns}
                      onChange={(e) => handleInputChange("duns", e.target.value)}
                      placeholder="9 chiffres (ex: 804735132)"
                      className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      maxLength="10"
                    />
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      {"Local Identifier"}
                    </label>
                    <input
                      type="text"
                      value={searchCriteria.local_identifier}
                      onChange={(e) => handleInputChange("local_identifier", e.target.value)}
                      placeholder="SIRET, EIN, RUC, etc..."
                      className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      {"Company Name"}
                    </label>
                    <input
                      type="text"
                      value={searchCriteria.company_name}
                      onChange={(e) => handleInputChange("company_name", e.target.value)}
                      placeholder="Ex: Apple Inc., Microsoft Corp..."
                      className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                    
                    {/* Checkbox Exact Match */}
                    {searchCriteria.company_name && (
                      <div className="mt-2 flex items-center">
                        <input
                          type="checkbox"
                          id="exact-match"
                          checked={searchCriteria.exact_match}
                          onChange={(e) => handleInputChange("exact_match", e.target.checked)}
                          className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                        />
                        <label htmlFor="exact-match" className="ml-2 text-sm text-gray-700">
                          <span className="font-medium">{"Exact Match"}</span>
                          <span className="text-gray-500 ml-1">({"Search only exact names"})</span>
                        </label>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Section Adresse */}
              <div className="mb-8">
                <h3 className="text-md font-medium text-gray-800 mb-4 pb-2 border-b border-gray-200">{"🏢 Address"}</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  <div className="lg:col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      {"Address"}
                    </label>
                    <input
                      type="text"
                      value={searchCriteria.address}
                      onChange={(e) => handleInputChange("address", e.target.value)}
                      placeholder="Ex: One Apple Park Way, 7 Place de la Gare..."
                      className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      {"City"}
                    </label>
                    <input
                      type="text"
                      value={searchCriteria.city}
                      onChange={(e) => handleInputChange("city", e.target.value)}
                      placeholder="Ex: Cupertino, Paris, Londres..."
                      className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      {"Postal Code"}
                    </label>
                    <input
                      type="text"
                      value={searchCriteria.postal_code}
                      onChange={(e) => handleInputChange("postal_code", e.target.value)}
                      placeholder="Ex: 95014, 75001, SW1A 1AA..."
                      className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      {"State"}
                    </label>
                    <input
                      type="text"
                      value={searchCriteria.state}
                      onChange={(e) => handleInputChange("state", e.target.value)}
                      placeholder="Ex: California, Île-de-France..."
                      className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      {"Country/Region"}
                    </label>
                    <input
                      type="text"
                      value={searchCriteria.country}
                      onChange={(e) => handleInputChange("country", e.target.value)}
                      placeholder="Ex: France, United States, Germany..."
                      className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      {"Continent"}
                    </label>
                    <select
                      value={searchCriteria.continent}
                      onChange={(e) => handleInputChange("continent", e.target.value)}
                      className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    >
                      <option value="">{"Select continent"}</option>
                      <option value="Europe">{"Europe"}</option>
                      <option value="Amérique du Nord">{"North America"}</option>
                      <option value="Amérique du Sud">{"South America"}</option>
                      <option value="Asie">{"Asia"}</option>
                      <option value="Afrique">{"Africa"}</option>
                      <option value="Océanie">{"Oceania"}</option>
                      <option value="Antarctique">{"Antarctica"}</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Section Contact */}
              <div className="mb-8">
                <h3 className="text-md font-medium text-gray-800 mb-4 pb-2 border-b border-gray-200">{"📞 Contact"}</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  <div className="lg:col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      {"Phone/Fax"}
                    </label>
                    <input
                      type="text"
                      value={searchCriteria.phone_fax}
                      onChange={(e) => handleInputChange("phone_fax", e.target.value)}
                      placeholder="Ex: +1-408-996-1010, +33-1-23-45-67-89..."
                      className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                  </div>
                  
                  <div className="space-y-4">
                    <div className="flex items-center">
                      <input
                        type="checkbox"
                        id="has_phone"
                        checked={searchCriteria.has_phone}
                        onChange={(e) => handleInputChange("has_phone", e.target.checked)}
                        className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                      />
                      <label htmlFor="has_phone" className="ml-2 block text-sm text-gray-700">
                        {"Phone Present"}
                      </label>
                    </div>
                    
                    <div className="flex items-center">
                      <input
                        type="checkbox"
                        id="has_fax"
                        checked={searchCriteria.has_fax}
                        onChange={(e) => handleInputChange("has_fax", e.target.checked)}
                        className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                      />
                      <label htmlFor="has_fax" className="ml-2 block text-sm text-gray-700">
                        {"Fax Present"}
                      </label>
                    </div>
                  </div>
                </div>
              </div>
              
              {/* Search Help */}
              <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-md">
                <h4 className="text-sm font-medium text-blue-800 mb-2">💡 Stratégies de recherche D&B :</h4>
                <div className="text-xs text-blue-700 space-y-1">
                  <p>• <strong>Recherche précise :</strong> D-U-N-S® ou Identifiant local</p>
                  <p>• <strong>Recherche standard :</strong> Raison sociale + Pays/Région + Ville</p>
                  <p>• <strong>Recherche étendue :</strong> Raison sociale + Adresse complète</p>
                  <p>• <strong>Recherche géographique :</strong> Filtrage par continent, pays, état</p>
                  <p>• <strong>Recherche par contact :</strong> Numéro de téléphone/fax avec présence</p>
                </div>
              </div>
              
              <div className="flex justify-center">
                <button
                  onClick={handleUnifiedSearch}
                  disabled={loading}
                  className="px-8 py-3 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium flex items-center"
                >
                  {loading ? (
                    <>
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                      {"D&B Search in progress..."}
                    </>
                  ) : (
                    <>
                      <svg className="h-5 w-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                      </svg>
                      {"Launch D&B Search"}
                    </>
                  )}
                </button>
              </div>
            </div>
          )}

          {/* Error Display */}
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-md p-4 mb-8">
              <div className="flex">
                <div className="ml-3">
                  <h3 className="text-sm font-medium text-red-800">
                    Erreur
                  </h3>
                  <div className="mt-2 text-sm text-red-700">
                    {error}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Search Results with new table design */}
          {activeTab === "search" && searchResults.length > 0 && (
            <div className="mt-6">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-medium text-gray-900">
                  {"Search Results"} ({searchResults.length})
                </h3>
                {searchResults.length > 0 && (
                  <span className="text-sm text-gray-500">
                    {searchResults.length} résultat{searchResults.length > 1 ? 's' : ''} trouvé{searchResults.length > 1 ? 's' : ''}
                  </span>
                )}
              </div>
              
              <div className="overflow-x-auto">
                <table className="min-w-full bg-white">
                  <thead className="bg-gray-800 text-white">
                    <tr>
                      <th className="px-4 py-3 text-left text-sm font-semibold">{"D-U-N-S®"}</th>
                      <th className="px-4 py-3 text-left text-sm font-semibold">{"Company Name"}</th>
                      <th className="px-4 py-3 text-left text-sm font-semibold">{"Match Score"}</th>
                      <th className="px-4 py-3 text-left text-sm font-semibold">{"Address"}</th>
                      <th className="px-4 py-3 text-left text-sm font-semibold">{"City"}</th>
                      <th className="px-4 py-3 text-left text-sm font-semibold">{"Country/Region"}</th>
                      <th className="px-4 py-3 text-left text-sm font-semibold">{"Registration"}</th>
                      <th className="px-4 py-3 text-center text-sm font-semibold">{"Action"}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {searchResults.map((result, index) => (
                      <tr key={index} className={`${index % 2 === 0 ? 'bg-white' : 'bg-gray-50'} hover:bg-blue-50 transition-colors`}>
                        <td className="px-4 py-3 text-sm font-mono text-blue-700 font-medium">
                          {result.duns}
                        </td>
                        <td className="px-4 py-3 text-sm">
                          <div>
                            <div className="font-medium text-gray-900">
                              {result.company_name}
                            </div>
                            {result.legal_name && result.legal_name !== result.company_name && (
                              <div className="text-xs text-gray-500 mt-1">
                                {result.legal_name}
                              </div>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-sm">
                          {result.ranking_info ? (
                            <div className="flex items-center">
                              <span className={`inline-flex px-2 py-1 rounded-full text-xs font-medium ${
                                result.ranking_info.confidence_code >= 8
                                  ? 'bg-green-100 text-green-800'
                                  : result.ranking_info.confidence_code >= 6
                                  ? 'bg-blue-100 text-blue-800'
                                  : result.ranking_info.confidence_code >= 4
                                  ? 'bg-yellow-100 text-yellow-800'
                                  : 'bg-red-100 text-red-800'
                              }`}>
                                {result.ranking_info.confidence_code}/10
                              </span>
                            </div>
                          ) : (
                            <span className="text-gray-400">-</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-700">
                          {result.address?.street || '-'}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-700">
                          {result.address?.city || '-'}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-700">
                          {result.address?.country || '-'}
                        </td>
                        <td className="px-4 py-3 text-sm">
                          {result.registration_numbers && result.registration_numbers.length > 0 ? (
                            <div className="text-xs font-mono text-green-700">
                              {result.registration_numbers[0].number}
                              {result.registration_numbers.length > 1 && (
                                <div className="text-gray-500">+{result.registration_numbers.length - 1}</div>
                              )}
                            </div>
                          ) : (
                            <span className="text-gray-400">-</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <button
                            onClick={() => navigateToDetails(result)}
                            className="inline-flex items-center px-3 py-1 bg-green-600 text-white text-sm font-medium rounded-md hover:bg-green-700 transition-colors"
                          >
                            <svg className="h-4 w-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                            </svg>
                            {"View Details"}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* No Results Message */}
          {activeTab === "search" && searchResults.length === 0 && !loading && (
            <div className="text-center py-12">
              <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <h3 className="mt-2 text-sm font-medium text-gray-900">{"No results found"}</h3>
              <p className="mt-1 text-sm text-gray-500">
                {"No results to display"}
              </p>
            </div>
          )}

          {/* Cached Companies */}
          {activeTab === "cached" && (
            <div className="bg-white rounded-lg shadow">
              <div className="px-6 py-4 border-b border-gray-200">
                <h3 className="text-lg font-medium text-gray-900">
                  Entreprises consultées récemment
                </h3>
              </div>
              {cachedCompanies.length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-gray-500">Aucune entreprise en cache</p>
                </div>
              ) : (
                <div className="divide-y divide-gray-200">
                  {cachedCompanies.map((company, index) => (
                    <div key={index} className="px-6 py-4 hover:bg-gray-50 cursor-pointer"
                         onClick={() => handleSelectCompany(company)}>
                      <div className="flex justify-between items-start">
                        <div className="flex-1">
                          <h4 className="text-sm font-medium text-gray-900">
                            {company.company_name}
                          </h4>
                          <p className="text-sm text-gray-500 mt-1">
                            DUNS: {company.duns}
                          </p>
                          <p className="text-sm text-gray-500">
                            Consulté le: {new Date(company.last_updated).toLocaleDateString('fr-FR')}
                          </p>
                          {company.search_criteria && (
                            <p className="text-xs text-blue-600 mt-1">
                              Critères: {getSearchCriteriaText(company.search_criteria)}
                            </p>
                          )}
                        </div>
                        <button className="ml-4 px-3 py-1 bg-blue-100 text-blue-700 rounded-full text-xs hover:bg-blue-200 transition-colors">
                          Voir détails
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
            </div>
          </>
        )}

        {/* Page des résultats */}
        {currentPage === 'results' && (
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
            {/* En-tête des résultats */}
            <div className="flex justify-between items-center mb-6">
              <div>
                <h1 className="text-2xl font-bold text-gray-900">
                  {"Search Results"}
                </h1>
                <p className="mt-2 text-sm text-gray-600">
                  {searchResults.length} {searchResults.length > 1 ? "results found" : "result found"}
                </p>
              </div>
              <button
                onClick={() => setCurrentPage('search')}
                className="px-4 py-2 bg-gray-600 text-white rounded-md text-sm font-medium hover:bg-gray-700 transition-colors flex items-center"
              >
                ← {"New Search"}
              </button>
            </div>

            {/* Table des résultats */}
            {searchResults.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="min-w-full bg-white border border-gray-200">
                  <thead className="bg-gray-800 text-white">
                    <tr>
                      <th className="px-4 py-3 text-left text-sm font-semibold">{"D-U-N-S®"}</th>
                      <th className="px-4 py-3 text-left text-sm font-semibold">{"Company Name"}</th>
                      <th className="px-4 py-3 text-left text-sm font-semibold">{"Match Score"}</th>
                      <th className="px-4 py-3 text-left text-sm font-semibold">{"Address"}</th>
                      <th className="px-4 py-3 text-left text-sm font-semibold">{"City"}</th>
                      <th className="px-4 py-3 text-left text-sm font-semibold">{"Country/Region"}</th>
                      <th className="px-4 py-3 text-left text-sm font-semibold">{"Registration"}</th>
                      <th className="px-4 py-3 text-center text-sm font-semibold">{"Action"}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {searchResults.map((result, index) => (
                      <tr key={index} className={`${index % 2 === 0 ? 'bg-white' : 'bg-gray-50'} hover:bg-blue-50 transition-colors`}>
                        <td className="px-4 py-3 text-sm font-mono text-blue-700 font-medium border-b border-gray-200">
                          {result.duns}
                        </td>
                        <td className="px-4 py-3 text-sm border-b border-gray-200">
                          <div>
                            <div className="font-medium text-gray-900">
                              {result.company_name}
                            </div>
                            {result.legal_name && result.legal_name !== result.company_name && (
                              <div className="text-xs text-gray-500 mt-1">
                                {result.legal_name}
                              </div>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-sm border-b border-gray-200">
                          {result.ranking_info ? (
                            <div className="flex items-center">
                              <span className={`inline-flex px-2 py-1 rounded-full text-xs font-medium ${
                                result.ranking_info.confidence_code >= 8
                                  ? 'bg-green-100 text-green-800'
                                  : result.ranking_info.confidence_code >= 6
                                  ? 'bg-blue-100 text-blue-800'
                                  : result.ranking_info.confidence_code >= 4
                                  ? 'bg-yellow-100 text-yellow-800'
                                  : 'bg-red-100 text-red-800'
                              }`}>
                                {result.ranking_info.confidence_code}/10
                              </span>
                            </div>
                          ) : (
                            <span className="text-gray-400">-</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-700 border-b border-gray-200">
                          {result.address?.street || '-'}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-700 border-b border-gray-200">
                          {result.address?.city || '-'}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-700 border-b border-gray-200">
                          {result.address?.country || '-'}
                        </td>
                        <td className="px-4 py-3 text-sm border-b border-gray-200">
                          {result.registration_numbers && result.registration_numbers.length > 0 ? (
                            <div className="text-xs font-mono text-green-700">
                              {result.registration_numbers[0].number}
                              {result.registration_numbers.length > 1 && (
                                <div className="text-gray-500">+{result.registration_numbers.length - 1}</div>
                              )}
                            </div>
                          ) : (
                            <span className="text-gray-400">-</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-center border-b border-gray-200">
                          <button
                            onClick={() => navigateToDetails(result)}
                            className="inline-flex items-center px-3 py-1 bg-green-600 text-white text-sm font-medium rounded-md hover:bg-green-700 transition-colors"
                          >
                            <svg className="h-4 w-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                            </svg>
                            {"View Details"}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="text-center py-12">
                <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <h3 className="mt-2 text-sm font-medium text-gray-900">{"No results found"}</h3>
                <p className="mt-1 text-sm text-gray-500">
                  {"No results to display"}
                </p>
              </div>
            )}
          </div>
        )}

        {/* Page des détails */}
        {currentPage === 'details' && selectedCompany && (
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
            {/* En-tête avec bouton retour */}
            <div className="flex justify-between items-center mb-6">
              <div>
                <h1 className="text-2xl font-bold text-gray-900">
                  {"Company Details"}
                </h1>
                <p className="mt-1 text-sm text-gray-600">
                  {selectedCompany.company_name}
                </p>
              </div>
              <button
                onClick={backToResults}
                className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 transition-colors flex items-center"
              >
                {"← Back to Results"}
              </button>
            </div>

            {/* Détails de l'entreprise */}
            <div className="bg-white rounded-lg shadow mb-8">
              <div className="px-6 py-4 border-b border-gray-200 bg-blue-600 text-white">
                <div className="flex items-center justify-between">
                  <h3 className="text-xl font-semibold flex items-center">
                    {selectedCompany.company_name}
                    {selectedCompany.ranking_info && (
                      <span className="ml-4 px-3 py-1 bg-white bg-opacity-20 rounded-full text-sm">
                        Score: {selectedCompany.ranking_info.confidence_code}/10
                      </span>
                    )}
                    {/* Statut opérationnel */}
                    {selectedCompany.operating_status && (
                      <span className={`ml-2 px-2 py-1 rounded-full text-xs font-medium ${
                        selectedCompany.operating_status.toLowerCase().includes('active') 
                          ? 'bg-green-500 text-white' 
                          : 'bg-red-500 text-white'
                      }`}>
                        {selectedCompany.operating_status}
                      </span>
                    )}
                  </h3>
                  {/* Navigation Back Button */}
                  {navigationHistory.length > 0 && (
                    <button
                      onClick={navigateBack}
                      className="px-4 py-2 bg-white bg-opacity-20 hover:bg-opacity-30 rounded-md text-sm font-medium transition-colors flex items-center"
                    >
                      {"← Back"}
                    </button>
                  )}
                </div>
                {selectedCompany.legal_name && selectedCompany.legal_name !== selectedCompany.company_name && (
                  <p className="text-blue-100 mt-1">
                    {"Legal Name"}: {selectedCompany.legal_name}
                  </p>
                )}
              </div>
              
              <div className="px-6 py-6">
                {/* Section Identification - Enhanced */}
                <div className="mb-8">
                  <div className="bg-blue-500 text-white px-4 py-2 rounded-t-md">
                    <h4 className="font-semibold">{"Identification & Status"}</h4>
                  </div>
                  <div className="border border-blue-500 border-t-0 rounded-b-md p-4 bg-blue-50">
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                      {/* Colonne 1: Identifiants */}
                      <div>
                        <h5 className="font-medium text-gray-900 mb-3">Identifiants D&B</h5>
                        <div className="space-y-2">
                          <div className="bg-white p-3 rounded border">
                            <div className="text-xs text-gray-500 font-medium">Numéro D-U-N-S®</div>
                            <div className="text-lg font-mono text-blue-600 font-bold">{selectedCompany.duns}</div>
                          </div>
                          
                          {/* Type d'établissement */}
                          {selectedCompany.business_type && (
                            <div className="bg-white p-3 rounded border">
                              <div className="text-xs text-gray-500 font-medium">Type d'établissement</div>
                              <div className="text-sm font-medium text-gray-800">
                                {selectedCompany.business_type.includes('Headquarters') || selectedCompany.business_type.includes('Single') 
                                  ? "🏢 Headquarters" 
                                  : "🏬 Establishment"}
                              </div>
                              <div className="text-xs text-gray-600 mt-1">{selectedCompany.business_type}</div>
                            </div>
                          )}
                          
                          {/* Statut opérationnel */}
                          {selectedCompany.operating_status && (
                            <div className="bg-white p-3 rounded border">
                              <div className="text-xs text-gray-500 font-medium">{"Operating Status"}</div>
                              <div className={`text-sm font-medium ${
                                selectedCompany.operating_status.toLowerCase().includes('active') 
                                  ? 'text-green-600' 
                                  : 'text-red-600'
                              }`}>
                                {selectedCompany.operating_status.toLowerCase().includes('active') ? "✅ Active" : "❌ Inactive"}
                              </div>
                              <div className="text-xs text-gray-600 mt-1">{selectedCompany.operating_status}</div>
                            </div>
                          )}
                        </div>
                      </div>
                      
                      {/* Colonne 2: Codes sectoriels */}
                      <div>
                        <h5 className="font-medium text-gray-900 mb-3">Codes sectoriels</h5>
                        <div className="space-y-2">
                          {/* Code SIC principal */}
                          {selectedCompany.primary_sic_code && (
                            <div className="bg-white p-3 rounded border">
                              <div className="text-xs text-gray-500 font-medium">Code SIC principal</div>
                              <div className="text-sm font-mono text-purple-600 font-bold">{selectedCompany.primary_sic_code}</div>
                              {selectedCompany.primary_sic_description && (
                                <div className="text-xs text-gray-600 mt-1">{selectedCompany.primary_sic_description}</div>
                              )}
                            </div>
                          )}
                          
                          {/* Code NAICS */}
                          {selectedCompany.naics_code && (
                            <div className="bg-white p-3 rounded border">
                              <div className="text-xs text-gray-500 font-medium">Code NAICS</div>
                              <div className="text-sm font-mono text-purple-600 font-bold">{selectedCompany.naics_code}</div>
                              {selectedCompany.naics_description && (
                                <div className="text-xs text-gray-600 mt-1">{selectedCompany.naics_description}</div>
                              )}
                            </div>
                          )}
                          
                          {/* Secteur d'activité */}
                          {selectedCompany.industry && (
                            <div className="bg-white p-3 rounded border">
                              <div className="text-xs text-gray-500 font-medium">Secteur d'activité</div>
                              <div className="text-sm text-gray-800">{selectedCompany.industry}</div>
                            </div>
                          )}
                        </div>
                      </div>
                      
                      {/* Colonne 3: Identifiants nationaux */}
                      <div>
                        <h5 className="font-medium text-gray-900 mb-3">Identifiants nationaux</h5>
                        <div className="space-y-2">
                          {/* Numéros d'enregistrement officiels */}
                          {selectedCompany.registration_numbers && selectedCompany.registration_numbers.length > 0 ? (
                            selectedCompany.registration_numbers.map((reg, index) => (
                              <div key={index} className="bg-white p-3 rounded border">
                                <div className="flex flex-col space-y-1">
                                  <div className="flex items-center">
                                    <span className="font-mono text-green-700 font-medium">{reg.number}</span>
                                    {reg.is_preferred && (
                                      <span className="ml-2 px-1.5 py-0.5 bg-green-100 text-green-800 text-xs rounded-full">Principal</span>
                                    )}
                                  </div>
                                  <div className="text-xs text-gray-600">
                                    <span className="font-medium">Type:</span> {reg.type}
                                    {reg.class && <span className="ml-2"><span className="font-medium">Classe:</span> {reg.class}</span>}
                                    {reg.location && <span className="ml-2"><span className="font-medium">Lieu:</span> {reg.location}</span>}
                                  </div>
                                </div>
                              </div>
                            ))
                          ) : (
                            /* Identifiant national du critère de recherche */
                            selectedCompany.search_criteria && selectedCompany.search_criteria.national_id && (
                              <div className="bg-yellow-50 p-3 rounded border border-yellow-200">
                                <div className="flex flex-col space-y-1">
                                  <div className="flex items-center">
                                    <span className="font-mono text-orange-700 font-medium">{selectedCompany.search_criteria.national_id}</span>
                                    <span className="ml-2 px-1.5 py-0.5 bg-yellow-100 text-yellow-800 text-xs rounded-full">Critère de recherche</span>
                                  </div>
                                  <div className="text-xs text-gray-600">
                                    <span className="font-medium">Source:</span> Critère de recherche utilisé
                                  </div>
                                </div>
                              </div>
                            )
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Section Adresses - Enhanced with Postal vs Mailing */}
                <div className="mb-8">
                  <div className="bg-green-500 text-white px-4 py-2 rounded-t-md">
                    <h4 className="font-semibold">{"Address & Location"}</h4>
                  </div>
                  <div className="border border-green-500 border-t-0 rounded-b-md p-4 bg-green-50">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      {/* Adresse principale (Postal Address) */}
                      <div>
                        <h5 className="font-medium text-gray-900 mb-3 flex items-center">
                          <svg className="h-4 w-4 mr-1 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                          </svg>
                          Adresse postale (Siège)
                        </h5>
                        <div className="bg-white p-4 rounded border">
                          <div className="text-sm text-gray-700 space-y-1">
                            <p className="font-medium text-gray-900">{selectedCompany.company_name}</p>
                            {selectedCompany.address && (
                              <>
                                {/* Street */}
                                {selectedCompany.address.street && (
                                  <div>
                                    <span className="text-xs text-gray-500 font-medium">Street: </span>
                                    <span>{selectedCompany.address.street}</span>
                                  </div>
                                )}
                                
                                {/* Postal Code */}
                                {selectedCompany.address.postal_code && (
                                  <div>
                                    <span className="text-xs text-gray-500 font-medium">{"Postal Code"}: </span>
                                    <span>{selectedCompany.address.postal_code}</span>
                                  </div>
                                )}
                                
                                {/* City */}
                                {selectedCompany.address.city && (
                                  <div>
                                    <span className="text-xs text-gray-500 font-medium">{"City"}: </span>
                                    <span>{selectedCompany.address.city}</span>
                                  </div>
                                )}
                                
                                {/* State (optional) */}
                                {selectedCompany.address.state && (
                                  <div>
                                    <span className="text-xs text-gray-500 font-medium">{"State"}: </span>
                                    <span>{selectedCompany.address.state}</span>
                                  </div>
                                )}
                                
                                {/* Country */}
                                {selectedCompany.address.country && (
                                  <div>
                                    <span className="text-xs text-gray-500 font-medium">{"Country/Region"}: </span>
                                    <span className="font-medium">{selectedCompany.address.country}</span>
                                  </div>
                                )}
                                
                                {/* Coordonnées géographiques si disponibles */}
                                {selectedCompany.address.latitude && selectedCompany.address.longitude && (
                                  <div className="mt-2 text-xs text-gray-500">
                                    <span className="font-medium">Coordonnées:</span>
                                    <span>{selectedCompany.address.latitude}, {selectedCompany.address.longitude}</span>
                                  </div>
                                )}
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                      
                      {/* Adresse de correspondance (Mailing Address) */}
                      <div>
                        <h5 className="font-medium text-gray-900 mb-3 flex items-center">
                          <svg className="h-4 w-4 mr-1 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 4.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                          </svg>
                          Adresse de correspondance
                        </h5>
                        <div className="bg-white p-4 rounded border">
                          {selectedCompany.mailing_address ? (
                            <div className="text-sm text-gray-700">
                              <p className="font-medium text-gray-900">{selectedCompany.company_name}</p>
                              <p className="mt-1">{selectedCompany.mailing_address.street}</p>
                              <p>
                                {selectedCompany.mailing_address.postal_code && `${selectedCompany.mailing_address.postal_code} `}
                                {selectedCompany.mailing_address.city}
                                {selectedCompany.mailing_address.state && `, ${selectedCompany.mailing_address.state}`}
                              </p>
                              {selectedCompany.mailing_address.country && (
                                <p className="font-medium">{selectedCompany.mailing_address.country}</p>
                              )}
                            </div>
                          ) : (
                            <div className="text-sm text-gray-500 italic">
                              Identique à l'adresse postale
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Section Contact & Communication */}
                <div className="mb-8">
                  <div className="bg-orange-500 text-white px-4 py-2 rounded-t-md">
                    <h4 className="font-semibold">{"Contact & Communication"}</h4>
                  </div>
                  <div className="border border-orange-500 border-t-0 rounded-b-md p-4 bg-orange-50">
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                      {/* Téléphone */}
                      {selectedCompany.phone && (
                        <div className="bg-white p-3 rounded border">
                          <div className="text-xs text-gray-500 font-medium">Téléphone principal</div>
                          <div className="text-sm font-mono text-orange-600 font-medium">{selectedCompany.phone}</div>
                        </div>
                      )}
                      
                      {/* Fax */}
                      {selectedCompany.fax && (
                        <div className="bg-white p-3 rounded border">
                          <div className="text-xs text-gray-500 font-medium">Télécopieur</div>
                          <div className="text-sm font-mono text-orange-600 font-medium">{selectedCompany.fax}</div>
                        </div>
                      )}
                      
                      {/* Site web */}
                      {selectedCompany.website && (
                        <div className="bg-white p-3 rounded border">
                          <div className="text-xs text-gray-500 font-medium">Site web</div>
                          <a href={selectedCompany.website} target="_blank" rel="noopener noreferrer" 
                             className="text-sm text-blue-600 hover:text-blue-800 underline">
                            {selectedCompany.website}
                          </a>
                        </div>
                      )}
                      
                      {/* Email */}
                      {selectedCompany.email && (
                        <div className="bg-white p-3 rounded border">
                          <div className="text-xs text-gray-500 font-medium">Email</div>
                          <a href={`mailto:${selectedCompany.email}`} 
                             className="text-sm text-blue-600 hover:text-blue-800 underline">
                            {selectedCompany.email}
                          </a>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Section Informations financières et organisationnelles */}
                <div className="mb-8">
                  <div className="bg-purple-500 text-white px-4 py-2 rounded-t-md">
                    <h4 className="font-semibold">{"Financial Information"}</h4>
                  </div>
                  <div className="border border-purple-500 border-t-0 rounded-b-md p-4 bg-purple-50">
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                      {/* Nombre d'employés */}
                      {selectedCompany.employee_count && (
                        <div className="bg-white p-3 rounded border">
                          <div className="text-xs text-gray-500 font-medium">Nombre d'employés</div>
                          <div className="text-lg font-bold text-purple-600">{selectedCompany.employee_count.toLocaleString()}</div>
                        </div>
                      )}
                      
                      {/* Chiffre d'affaires */}
                      {selectedCompany.annual_revenue && (
                        <div className="bg-white p-3 rounded border">
                          <div className="text-xs text-gray-500 font-medium">Chiffre d'affaires annuel</div>
                          <div className="text-lg font-bold text-purple-600">{selectedCompany.annual_revenue}</div>
                        </div>
                      )}
                      
                      {/* Année de création */}
                      {selectedCompany.year_started && (
                        <div className="bg-white p-3 rounded border">
                          <div className="text-xs text-gray-500 font-medium">Année de création</div>
                          <div className="text-lg font-bold text-purple-600">{selectedCompany.year_started}</div>
                        </div>
                      )}
                      
                      {/* Forme juridique */}
                      {selectedCompany.legal_form && (
                        <div className="bg-white p-3 rounded border">
                          <div className="text-xs text-gray-500 font-medium">{"Legal Form"}</div>
                          <div className="text-sm font-medium text-gray-800">{selectedCompany.legal_form}</div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Section Hiérarchie Corporative */}
                {(loadingHierarchy || hierarchyData?.hierarchy || selectedCompany?.corporate_hierarchy) && (
                  <div className="mb-8">
                    <div className="bg-indigo-500 text-white px-4 py-2 rounded-t-md flex justify-between items-center">
                      <h4 className="font-semibold">{"Corporate Hierarchy"}</h4>
                      <div className="flex items-center space-x-2">
                        {(hierarchyData?.hierarchy || selectedCompany?.corporate_hierarchy) && (
                          <>
                            <button
                              onClick={exportHierarchyToExcel}
                              className="text-sm bg-green-600 hover:bg-green-700 px-3 py-1 rounded-md transition-colors flex items-center"
                              title={"Export to Excel"}
                            >
                              <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                              </svg>
                              {"Export to Excel"}
                            </button>
                            <button
                              onClick={() => setShowDownwardFamilyTree(!showDownwardFamilyTree)}
                              className="text-sm bg-indigo-600 hover:bg-indigo-700 px-3 py-1 rounded-md transition-colors"
                            >
                              {showDownwardFamilyTree ? "Hierarchy View" : "Downward Tree"}
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="border border-indigo-500 border-t-0 rounded-b-md p-4 bg-indigo-50">
                      {loadingHierarchy ? (
                        <div className="text-center py-4">
                          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600 mx-auto"></div>
                          <p className="mt-2 text-sm text-gray-600">Chargement des données de hiérarchie...</p>
                        </div>
                      ) : (hierarchyData?.hierarchy || selectedCompany?.corporate_hierarchy) ? (
                        <div className="space-y-6">
                          {(() => {
                            // Get hierarchy data from both sources
                            const hierarchy = hierarchyData?.hierarchy || selectedCompany?.corporate_hierarchy;
                            
                            // Show Downward Family Tree view
                            if (showDownwardFamilyTree) {
                              const currentEntityDuns = selectedCompany?.duns;
                              
                              // Filter for downward members - only subsidiaries at level 2 or higher
                              const allMembers = hierarchy?.familyTreeMembers || [];
                              const downwardMembers = allMembers.filter(member => 
                                member.hierarchyLevel >= 2 && member.relationshipCode === 'SUB'
                              );
                              
                              return (
                                <div>
                                  <h5 className="font-medium text-gray-900 mb-4">🌳 Arbre Familial Descendant</h5>
                                  <div className="bg-gradient-to-r from-blue-50 to-purple-50 border border-blue-200 rounded-md p-4">
                                    
                                    {/* Current Entity */}
                                    <div className="mb-4">
                                      <div className="flex items-center mb-2">
                                        <div className="w-3 h-3 bg-blue-500 rounded-full mr-2"></div>
                                        <span className="font-medium text-blue-800">Entité Actuelle</span>
                                      </div>
                                      <div className="bg-blue-100 border border-blue-300 rounded p-3 ml-5">
                                        <p className="font-semibold text-blue-900">{selectedCompany?.company_name}</p>
                                        <p className="text-sm text-blue-700">DUNS: {currentEntityDuns}</p>
                                        <p className="text-xs text-blue-600">{"Level"}: 1</p>
                                      </div>
                                    </div>
                                    
                                    {/* Downward Tree */}
                                    {downwardMembers.length > 0 ? (
                                      <div>
                                        <div className="flex items-center mb-3">
                                          <div className="w-3 h-3 bg-purple-500 rounded-full mr-2"></div>
                                          <span className="font-medium text-purple-800">Filiales & Subsidiaires ({downwardMembers.length})</span>
                                        </div>
                                        <div className="ml-5 space-y-2">
                                          {downwardMembers.map((member, index) => (
                                            <div key={index} className="flex items-start">
                                              <div className="flex-shrink-0 w-6 h-6 flex items-center justify-center">
                                                <div className="w-2 h-2 bg-purple-400 rounded-full"></div>
                                              </div>
                                              <div className="bg-purple-50 border border-purple-200 hover:border-purple-300 rounded p-3 flex-1 cursor-pointer transition-colors" onClick={() => navigateToCompany(member.duns, member.primaryName)}>
                                                <div className="flex justify-between items-start">
                                                  <div className="flex-1">
                                                    <p className="font-medium text-purple-900 hover:text-purple-700">{member.primaryName}</p>
                                                    <p className="text-sm text-purple-700">DUNS: {member.duns}</p>
                                                    <div className="flex items-center mt-1 space-x-2">
                                                      <span className="inline-block px-2 py-1 bg-purple-200 text-purple-800 text-xs rounded">
                                                        {"Level"}: {member.hierarchyLevel}
                                                      </span>
                                                      {member.relationshipDescription && (
                                                        <span className="inline-block px-2 py-1 bg-gray-200 text-gray-700 text-xs rounded">
                                                          {member.relationshipDescription}
                                                        </span>
                                                      )}
                                                    </div>
                                                    {member.address && (
                                                      <p className="text-xs text-purple-600 mt-1">
                                                        📍 {member.address.city}, {member.address.country}
                                                      </p>
                                                    )}
                                                  </div>
                                                  <div className="ml-2">
                                                    <svg className="w-4 h-4 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                                    </svg>
                                                  </div>
                                                </div>
                                              </div>
                                            </div>
                                          ))}
                                        </div>
                                      </div>
                                    ) : (
                                      <div className="ml-5">
                                        <div className="bg-gray-100 border border-gray-300 rounded p-3">
                                          <p className="text-sm text-gray-600">Aucune filiale ou subsidiaire trouvée</p>
                                          <p className="text-xs text-gray-500 mt-1">
                                            Debug: Total members: {allMembers.length}, Subsidiaires niveau 2+: {downwardMembers.length}
                                          </p>
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              );
                            }
                            
                            // Show regular hierarchy view
                            return (
                              <>
                                {/* Global Ultimate */}
                                {hierarchy.globalUltimate && (
                                  <div>
                                    <h5 className="font-medium text-gray-900 mb-2">{"Global Ultimate"}</h5>
                                    <div className="bg-green-50 border border-green-200 hover:border-green-300 rounded-md p-3 cursor-pointer transition-colors" onClick={() => navigateToCompany(hierarchy.globalUltimate.duns, hierarchy.globalUltimate.primaryName)}>
                                      <div className="flex justify-between items-center">
                                        <div>
                                          <p className="font-medium text-green-800 hover:text-green-600">{hierarchy.globalUltimate.primaryName}</p>
                                          <p className="text-sm text-green-600">DUNS: {hierarchy.globalUltimate.duns}</p>
                                          {hierarchy.globalUltimate.address && (
                                            <p className="text-xs text-green-500 mt-1">
                                              📍 {hierarchy.globalUltimate.address.city}, {hierarchy.globalUltimate.address.country}
                                            </p>
                                          )}
                                        </div>
                                        <svg className="w-4 h-4 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                        </svg>
                                      </div>
                                    </div>
                                  </div>
                                )}

                                {/* Domestic Ultimate */}
                                {hierarchy.domesticUltimate && (
                                  <div>
                                    <h5 className="font-medium text-gray-900 mb-2">{"Domestic Ultimate"}</h5>
                                    <div className="bg-blue-50 border border-blue-200 hover:border-blue-300 rounded-md p-3 cursor-pointer transition-colors" onClick={() => navigateToCompany(hierarchy.domesticUltimate.duns, hierarchy.domesticUltimate.primaryName)}>
                                      <div className="flex justify-between items-center">
                                        <div>
                                          <p className="font-medium text-blue-800 hover:text-blue-600">{hierarchy.domesticUltimate.primaryName}</p>
                                          <p className="text-sm text-blue-600">DUNS: {hierarchy.domesticUltimate.duns}</p>
                                          {hierarchy.domesticUltimate.address && (
                                            <p className="text-xs text-blue-500 mt-1">
                                              📍 {hierarchy.domesticUltimate.address.city}, {hierarchy.domesticUltimate.address.country}
                                            </p>
                                          )}
                                        </div>
                                        <svg className="w-4 h-4 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                        </svg>
                                      </div>
                                    </div>
                                  </div>
                                )}

                                {/* Subsidiaries */}
                                {hierarchy.subsidiaries && hierarchy.subsidiaries.length > 0 && (
                                  <div>
                                    <h5 className="font-medium text-gray-900 mb-2">{"Subsidiaries"} ({hierarchy.subsidiaries.length})</h5>
                                    <div className="bg-purple-50 border border-purple-200 rounded-md p-3 max-h-48 overflow-y-auto">
                                      {hierarchy.subsidiaries.map((subsidiary, index) => (
                                        <div key={index} className="flex justify-between items-center py-2 border-b last:border-b-0 hover:bg-purple-100 cursor-pointer transition-colors rounded px-2" onClick={() => navigateToCompany(subsidiary.duns, subsidiary.primaryName)}>
                                          <div className="flex-1">
                                            <p className="font-medium text-purple-800 hover:text-purple-600">{subsidiary.primaryName}</p>
                                            <p className="text-sm text-purple-600">DUNS: {subsidiary.duns}</p>
                                            {subsidiary.address && (
                                              <p className="text-xs text-purple-500 mt-1">
                                                📍 {subsidiary.address.city}, {subsidiary.address.country}
                                              </p>
                                            )}
                                          </div>
                                          <svg className="w-4 h-4 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                          </svg>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}

                                {/* Family Tree */}
                                {hierarchy.familyTreeMembers && hierarchy.familyTreeMembers.length > 0 && (
                                  <div>
                                    <h5 className="font-medium text-gray-900 mb-2">{"Family Tree"} ({hierarchy.familyTreeMembers.length} {"members"})</h5>
                                    <div className="bg-gray-50 border border-gray-200 rounded-md p-3 max-h-48 overflow-y-auto">
                                      {hierarchy.familyTreeMembers.map((member, index) => (
                                        <div key={index} className="flex justify-between items-center py-2 border-b last:border-b-0 hover:bg-gray-100 cursor-pointer transition-colors rounded px-2" onClick={() => navigateToCompany(member.duns, member.primaryName)}>
                                          <div className="flex-1">
                                            <p className="font-medium text-gray-800 hover:text-blue-600">{member.primaryName}</p>
                                            <p className="text-sm text-gray-600">DUNS: {member.duns}</p>
                                            {member.hierarchyLevel !== undefined && (
                                              <span className="inline-block px-2 py-1 bg-gray-200 text-gray-700 text-xs rounded mt-1">
                                                {"Level"}: {member.hierarchyLevel}
                                              </span>
                                            )}
                                          </div>
                                          <div className="ml-2">
                                            <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                            </svg>
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}

                                {/* Data Source */}
                                <div className="text-xs text-gray-500 text-center pt-4 border-t border-gray-200">
                                  {"Source"}: {hierarchyData?.data_source || "D&B Hierarchy API"}
                                </div>
                              </>
                            ); // Close regular hierarchy view
                          })()}
                        </div>
                      ) : (
                        <div className="text-center py-4">
                          <p className="text-sm text-gray-600">Aucune information de hiérarchie disponible</p>
                        </div>
                      )}
                    </div>
                  </div>
                )}
                
                <div className="mt-6 pt-6 border-t border-gray-200">
                  <div className="flex justify-between items-center text-xs text-gray-500">
                    <p>{"Last Updated"}: {new Date(selectedCompany.last_updated).toLocaleString('fr-FR')}</p>
                    <p>{"Source"}: {selectedCompany.data_source || "D&B API"}</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default App;