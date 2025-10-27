from fastapi import FastAPI, APIRouter, HTTPException, Depends, status
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from jose import JWTError, jwt
from passlib.context import CryptContext
from datetime import datetime, timedelta, timezone
from pathlib import Path
from pydantic import BaseModel, Field, ConfigDict
from typing import List, Optional, Dict, Any
import os
import logging
import uuid
import httpx

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# JWT Configuration
SECRET_KEY = os.environ.get("JWT_SECRET_KEY", "your-secret-key-change-this-in-production")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 480  # 8 hours

# Password hashing
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/login")

# D&B API Configuration
DNB_API_KEY = os.environ.get("DNB_API_KEY", "")
DNB_API_SECRET = os.environ.get("DNB_API_SECRET", "")
DNB_API_BASE_URL = "https://plus.dnb.com/v1"

# Create the main app
app = FastAPI(title="D&B Business Partner Search API")
api_router = APIRouter(prefix="/api")

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# ============= MODELS =============

class Token(BaseModel):
    access_token: str
    token_type: str

class TokenData(BaseModel):
    username: Optional[str] = None

class User(BaseModel):
    username: str
    email: Optional[str] = None
    full_name: Optional[str] = None
    disabled: Optional[bool] = None

class UserInDB(User):
    hashed_password: str

class LoginRequest(BaseModel):
    username: str
    password: str

class Address(BaseModel):
    street: Optional[str] = None
    additional_lines: Optional[List[str]] = None
    city: Optional[str] = None
    state: Optional[str] = None
    postal_code: Optional[str] = None
    country: Optional[str] = None
    continent: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None

class RegistrationNumber(BaseModel):
    type: str
    number: str
    is_preferred: Optional[bool] = False
    class_field: Optional[str] = Field(None, alias="class")
    location: Optional[str] = None

class RankingInfo(BaseModel):
    confidence_code: int
    match_quality: Optional[str] = None

class CompanySearchCriteria(BaseModel):
    model_config = ConfigDict(extra="allow")
    
    duns: Optional[str] = None
    local_identifier: Optional[str] = None
    company_name: Optional[str] = None
    address: Optional[str] = None
    city: Optional[str] = None
    postal_code: Optional[str] = None
    state: Optional[str] = None
    country: Optional[str] = None
    continent: Optional[str] = None
    phone_fax: Optional[str] = None
    has_phone: Optional[bool] = None
    has_fax: Optional[bool] = None
    exact_match: Optional[bool] = False

class HierarchyMember(BaseModel):
    duns: str
    primaryName: str
    legalName: Optional[str] = None
    operatingStatus: Optional[str] = None
    address: Optional[Address] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    website: Optional[str] = None
    relationshipCode: Optional[str] = None
    relationshipDescription: Optional[str] = None
    hierarchyLevel: Optional[int] = None
    industry: Optional[str] = None
    employeeCount: Optional[int] = None
    salesVolume: Optional[str] = None
    yearStarted: Optional[int] = None
    legalForm: Optional[str] = None
    nationalIds: Optional[str] = None

class CorporateHierarchy(BaseModel):
    globalUltimate: Optional[HierarchyMember] = None
    domesticUltimate: Optional[HierarchyMember] = None
    parent: Optional[HierarchyMember] = None
    subsidiaries: Optional[List[HierarchyMember]] = []
    familyTreeMembers: Optional[List[HierarchyMember]] = []

class Company(BaseModel):
    model_config = ConfigDict(extra="allow")
    
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    duns: str
    company_name: str
    legal_name: Optional[str] = None
    business_type: Optional[str] = None
    operating_status: Optional[str] = None
    address: Optional[Address] = None
    mailing_address: Optional[Address] = None
    phone: Optional[str] = None
    fax: Optional[str] = None
    email: Optional[str] = None
    website: Optional[str] = None
    primary_sic_code: Optional[str] = None
    primary_sic_description: Optional[str] = None
    naics_code: Optional[str] = None
    naics_description: Optional[str] = None
    industry: Optional[str] = None
    employee_count: Optional[int] = None
    annual_revenue: Optional[str] = None
    year_started: Optional[int] = None
    legal_form: Optional[str] = None
    registration_numbers: Optional[List[RegistrationNumber]] = []
    ranking_info: Optional[RankingInfo] = None
    corporate_hierarchy: Optional[CorporateHierarchy] = None
    last_updated: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    data_source: str = "D&B API"
    search_criteria: Optional[Dict[str, Any]] = None

# ============= AUTHENTICATION =============

# Mock user database (in production, use MongoDB)
fake_users_db = {
    "admin": {
        "username": "admin",
        "full_name": "Admin User",
        "email": "admin@dnb.com",
        "hashed_password": pwd_context.hash("D&B2025Secure!"),
        "disabled": False,
    }
}

def verify_password(plain_password, hashed_password):
    return pwd_context.verify(plain_password, hashed_password)

def get_password_hash(password):
    return pwd_context.hash(password)

def get_user(username: str):
    if username in fake_users_db:
        user_dict = fake_users_db[username]
        return UserInDB(**user_dict)

def authenticate_user(username: str, password: str):
    user = get_user(username)
    if not user:
        return False
    if not verify_password(password, user.hashed_password):
        return False
    return user

def create_access_token(data: dict, expires_delta: Optional[timedelta] = None):
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.now(timezone.utc) + expires_delta
    else:
        expire = datetime.now(timezone.utc) + timedelta(minutes=15)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt

async def get_current_user(token: str = Depends(oauth2_scheme)):
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username: str = payload.get("sub")
        if username is None:
            raise credentials_exception
        token_data = TokenData(username=username)
    except JWTError:
        raise credentials_exception
    user = get_user(username=token_data.username)
    if user is None:
        raise credentials_exception
    return user

async def get_current_active_user(current_user: User = Depends(get_current_user)):
    if current_user.disabled:
        raise HTTPException(status_code=400, detail="Inactive user")
    return current_user

@api_router.post("/login", response_model=Token)
async def login(login_data: LoginRequest):
    user = authenticate_user(login_data.username, login_data.password)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        data={"sub": user.username}, expires_delta=access_token_expires
    )
    return {"access_token": access_token, "token_type": "bearer"}

@api_router.get("/verify-token")
async def verify_token(current_user: User = Depends(get_current_active_user)):
    return {"username": current_user.username, "email": current_user.email}

# ============= MOCK DATA FUNCTIONS =============

def create_mock_company_data(duns: str) -> Optional[Company]:
    """Create comprehensive mock data for companies with full hierarchy"""
    
    mock_companies = {
        "804735132": {  # Apple Inc.
            "duns": "804735132",
            "company_name": "Apple Inc.",
            "legal_name": "Apple Inc.",
            "business_type": "Single Location",
            "operating_status": "Active",
            "address": Address(
                street="One Apple Park Way",
                city="Cupertino",
                state="CA",
                postal_code="95014",
                country="United States",
                continent="North America",
                latitude=37.3349,
                longitude=-122.0090
            ),
            "phone": "+1 408-996-1010",
            "website": "https://www.apple.com",
            "email": "contact@apple.com",
            "primary_sic_code": "3571",
            "primary_sic_description": "Electronic Computers",
            "naics_code": "334111",
            "naics_description": "Electronic Computer Manufacturing",
            "industry": "Technology Hardware",
            "employee_count": 164000,
            "annual_revenue": "$394.3B USD",
            "year_started": 1976,
            "legal_form": "Corporation",
            "registration_numbers": [
                RegistrationNumber(type="Federal Tax ID", number="94-2404110", is_preferred=True),
                RegistrationNumber(type="State Registration", number="C0806592", location="California")
            ],
            "ranking_info": RankingInfo(confidence_code=10, match_quality="Excellent"),
            "data_source": "Mock Data",
            "corporate_hierarchy": CorporateHierarchy(
                globalUltimate=HierarchyMember(
                    duns="804735132",
                    primaryName="Apple Inc.",
                    legalName="Apple Inc.",
                    operatingStatus="Active",
                    address=Address(street="One Apple Park Way", city="Cupertino", state="CA", country="United States"),
                    phone="+1 408-996-1010"
                ),
                domesticUltimate=HierarchyMember(
                    duns="804735132",
                    primaryName="Apple Inc.",
                    legalName="Apple Inc.",
                    operatingStatus="Active",
                    address=Address(street="One Apple Park Way", city="Cupertino", state="CA", country="United States"),
                    phone="+1 408-996-1010"
                ),
                subsidiaries=[
                    HierarchyMember(
                        duns="804735133",
                        primaryName="Apple Retail, Inc.",
                        legalName="Apple Retail, Inc.",
                        operatingStatus="Active",
                        address=Address(city="Cupertino", state="CA", country="United States"),
                        relationshipCode="SUB",
                        relationshipDescription="Wholly Owned Subsidiary",
                        hierarchyLevel=2
                    ),
                    HierarchyMember(
                        duns="804735134",
                        primaryName="Beats Electronics LLC",
                        legalName="Beats Electronics LLC",
                        operatingStatus="Active",
                        address=Address(city="Culver City", state="CA", country="United States"),
                        relationshipCode="SUB",
                        relationshipDescription="Wholly Owned Subsidiary",
                        hierarchyLevel=2
                    )
                ],
                familyTreeMembers=[
                    HierarchyMember(
                        duns="804735132",
                        primaryName="Apple Inc.",
                        hierarchyLevel=1,
                        relationshipCode="HQ"
                    ),
                    HierarchyMember(
                        duns="804735133",
                        primaryName="Apple Retail, Inc.",
                        hierarchyLevel=2,
                        relationshipCode="SUB"
                    ),
                    HierarchyMember(
                        duns="804735134",
                        primaryName="Beats Electronics LLC",
                        hierarchyLevel=2,
                        relationshipCode="SUB"
                    )
                ]
            )
        },
        "001234567": {  # Microsoft
            "duns": "001234567",
            "company_name": "Microsoft Corporation",
            "legal_name": "Microsoft Corporation",
            "business_type": "Headquarters",
            "operating_status": "Active",
            "address": Address(
                street="One Microsoft Way",
                city="Redmond",
                state="WA",
                postal_code="98052",
                country="United States",
                continent="North America"
            ),
            "phone": "+1 425-882-8080",
            "website": "https://www.microsoft.com",
            "primary_sic_code": "7372",
            "primary_sic_description": "Prepackaged Software",
            "industry": "Software",
            "employee_count": 221000,
            "annual_revenue": "$211.9B USD",
            "year_started": 1975,
            "legal_form": "Corporation",
            "registration_numbers": [
                RegistrationNumber(type="Federal Tax ID", number="91-1144442", is_preferred=True)
            ],
            "ranking_info": RankingInfo(confidence_code=10),
            "data_source": "Mock Data",
            "corporate_hierarchy": CorporateHierarchy(
                globalUltimate=HierarchyMember(
                    duns="001234567",
                    primaryName="Microsoft Corporation",
                    operatingStatus="Active"
                ),
                subsidiaries=[
                    HierarchyMember(
                        duns="001234568",
                        primaryName="LinkedIn Corporation",
                        operatingStatus="Active",
                        relationshipCode="SUB",
                        hierarchyLevel=2
                    )
                ]
            )
        },
        "313046411": {  # Google (Alphabet)
            "duns": "313046411",
            "company_name": "Google LLC",
            "legal_name": "Google LLC",
            "business_type": "Subsidiary",
            "operating_status": "Active",
            "address": Address(
                street="1600 Amphitheatre Parkway",
                city="Mountain View",
                state="CA",
                postal_code="94043",
                country="United States",
                continent="North America"
            ),
            "phone": "+1 650-253-0000",
            "website": "https://www.google.com",
            "primary_sic_code": "7375",
            "primary_sic_description": "Information Retrieval Services",
            "industry": "Internet Services",
            "employee_count": 190234,
            "annual_revenue": "$307.4B USD",
            "year_started": 1998,
            "legal_form": "LLC",
            "registration_numbers": [
                RegistrationNumber(type="Federal Tax ID", number="77-0493581", is_preferred=True)
            ],
            "ranking_info": RankingInfo(confidence_code=10),
            "data_source": "Mock Data",
            "corporate_hierarchy": CorporateHierarchy(
                globalUltimate=HierarchyMember(
                    duns="080442732",
                    primaryName="Alphabet Inc.",
                    operatingStatus="Active"
                ),
                parent=HierarchyMember(
                    duns="080442732",
                    primaryName="Alphabet Inc.",
                    relationshipCode="PAR"
                )
            )
        },
        "832563616": {  # Tesla
            "duns": "832563616",
            "company_name": "Tesla, Inc.",
            "legal_name": "Tesla, Inc.",
            "business_type": "Headquarters",
            "operating_status": "Active",
            "address": Address(
                street="1 Tesla Road",
                city="Austin",
                state="TX",
                postal_code="78725",
                country="United States",
                continent="North America"
            ),
            "phone": "+1 512-516-8177",
            "website": "https://www.tesla.com",
            "primary_sic_code": "3711",
            "primary_sic_description": "Motor Vehicles & Passenger Car Bodies",
            "industry": "Automotive Manufacturing",
            "employee_count": 127855,
            "annual_revenue": "$96.8B USD",
            "year_started": 2003,
            "legal_form": "Corporation",
            "registration_numbers": [
                RegistrationNumber(type="Federal Tax ID", number="91-2197729", is_preferred=True)
            ],
            "ranking_info": RankingInfo(confidence_code=9),
            "data_source": "Mock Data"
        }
    }
    
    if duns in mock_companies:
        company_data = mock_companies[duns]
        return Company(**company_data)
    return None

# ============= API ENDPOINTS =============

@api_router.get("/")
async def root():
    return {"message": "D&B Business Partner Search API", "version": "1.0"}

@api_router.post("/unified-search")
async def unified_search(
    criteria: CompanySearchCriteria,
    current_user: User = Depends(get_current_active_user)
):
    """Unified search endpoint supporting multiple D&B GRS search strategies"""
    
    try:
        logger.info(f"Unified search request: {criteria.model_dump(exclude_none=True)}")
        
        # Mock data search
        mock_data = [
            create_mock_company_data("804735132"),  # Apple
            create_mock_company_data("001234567"),  # Microsoft
            create_mock_company_data("313046411"),  # Google
            create_mock_company_data("832563616"),  # Tesla
        ]
        
        results = []
        for company in mock_data:
            if company is None:
                continue
                
            match = False
            
            # D-U-N-S exact match
            if criteria.duns and criteria.duns == company.duns:
                match = True
            
            # Local identifier (SIRET/SIREN) - exact match
            elif criteria.local_identifier:
                for reg in (company.registration_numbers or []):
                    if criteria.local_identifier in reg.number:
                        match = True
                        break
            
            # Company name search
            elif criteria.company_name:
                if criteria.company_name.lower() in company.company_name.lower():
                    match = True
            
            # Geographic search
            elif criteria.continent or criteria.country or criteria.city:
                if company.address:
                    if criteria.continent and criteria.continent == company.address.continent:
                        match = True
                    if criteria.country and criteria.country.lower() in (company.address.country or "").lower():
                        match = True
                    if criteria.city and criteria.city.lower() in (company.address.city or "").lower():
                        match = True
            
            # Phone/Fax search
            elif criteria.phone_fax:
                if company.phone and criteria.phone_fax in company.phone:
                    match = True
            
            # Phone presence
            elif criteria.has_phone:
                if company.phone:
                    match = True
            
            if match:
                company.search_criteria = criteria.model_dump(exclude_none=True)
                results.append(company)
        
        logger.info(f"Found {len(results)} results")
        
        # Cache results in MongoDB
        if results:
            for company in results:
                await db.cached_companies.update_one(
                    {"duns": company.duns},
                    {"$set": company.model_dump()},
                    upsert=True
                )
        
        return {"results": results, "count": len(results)}
        
    except Exception as e:
        logger.error(f"Search error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@api_router.get("/company-hierarchy/{duns}")
async def get_company_hierarchy(
    duns: str,
    current_user: User = Depends(get_current_active_user)
):
    """Get corporate hierarchy for a company"""
    
    try:
        company = create_mock_company_data(duns)
        
        if not company or not company.corporate_hierarchy:
            raise HTTPException(status_code=404, detail="Hierarchy not found")
        
        return {
            "duns": duns,
            "hierarchy": company.corporate_hierarchy.model_dump(),
            "data_source": "Mock Data",
            "last_updated": datetime.now(timezone.utc).isoformat()
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Hierarchy error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@api_router.get("/cached-companies", response_model=List[Company])
async def get_cached_companies(current_user: User = Depends(get_current_active_user)):
    """Get list of recently searched companies"""
    try:
        companies = await db.cached_companies.find({}, {"_id": 0}).sort("last_updated", -1).limit(50).to_list(50)
        return companies
    except Exception as e:
        logger.error(f"Error fetching cached companies: {str(e)}")
        return []

# ============= APP CONFIGURATION =============

app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)
