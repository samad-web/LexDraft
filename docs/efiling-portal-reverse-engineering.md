# eFiling 3.0 (filing.ecourts.gov.in/pdedev) — logged-in screens, reverse-engineered from public JS

Everything below was read from static JS that anyone can download with a GET request (no login, no POSTs, no PHP endpoints called).
Source files are in `efre/js/` (flattened names). References use the form `file:line`. **[inferred]** marks anything that was not read directly from code.

Short file names used below:
`LIT`=js_litigant.js, `CMP`=js_components.js, `DSH`=js_dashboard.js, `UPL`=js_upload_pleading.js, `EPY`=js_epay.js,
`APP`=js_applications.js, `VAK`=js_vakalat.js, `VID`=js_videoRecording.js, `PIX`=js_pleading_index.js, `PES`=js_pleading_esign.js,
`PET`=js_pleading_esign_test.js, `PSC`=js_portfolio_search_cases.js, `MCF`=js_portfolio_mycases_common_functions.js, `MYC`=js_portfolio_my_cases.js, `LGN`=../efcap2/login1.js.

---------------------------------------------------------------------------------------------------

## 0. Script discovery

### 0.1 Real JS found (HTTP 200, `application/javascript`)
| URL | saved as | bytes | how found |
|---|---|---|---|
| /pdedev/js/dashboard.js | js_dashboard.js | 86198 | already known |
| /pdedev/js/vakalat.js | js_vakalat.js | 32345 | already known |
| /pdedev/js/applications.js | js_applications.js | 43030 | already known |
| /pdedev/js/portfolio/search_cases.js | js_portfolio_search_cases.js | 78148 | already known |
| /pdedev/js/components.js | js_components.js | 67469 | referenced in login.html:23 |
| /pdedev/js/portfolio/mycases_common_functions.js | js_portfolio_mycases_common_functions.js | 16884 | login.html:1682 |
| /pdedev/dist1/js/eFileStyle.js | dist1_js_eFileStyle.js | 2895 | login.html:3280 (UI only, no AJAX) |
| /pdedev/js/upload_pleading.js | js_upload_pleading.js | 50878 | probe (controller name) |
| /pdedev/js/videoRecording.js | js_videoRecording.js | 85314 | probe (controller name) |
| **/pdedev/js/litigant.js** | **js_litigant.js** | **102906** | probe; **this is the New Case Filing script** (header comment LIT:13-17 says `Controller: advocate_case_registration/insertNewPDE/`) |
| /pdedev/js/pleading_esign.js | js_pleading_esign.js | 5948 | probe |
| /pdedev/js/pleading_esign_test.js | js_pleading_esign_test.js | 78456 | probe (endpoint name seen in UPL) |
| /pdedev/js/pleading_index.js | js_pleading_index.js | 6655 | probe (endpoint name seen in UPL) |
| /pdedev/js/epay.js | js_epay.js | 64619 | probe |
| /pdedev/js/portfolio/my_cases.js | js_portfolio_my_cases.js | 96932 | probe |
| /pdedev/js/login1.js | ../efcap2/login1.js | 38598 | already downloaded earlier |

### 0.2 Returned 404 (real 404, Apache page; a bogus name returns the same 404 so the check is reliable)
`/pdedev/js/<n>.js` for: registration (also commented out in login.html:76), advocate_case_registration, advocateCaseRegistration, Portfolio_new, portfolio_new, pde, PDE, newcase, new_case, newCase, caseFiling, case_filing, legal_heir, legalHeir, legalheir, legal-heir, fact, case_details, caseDetails, mvc, efile, eFile, uploadPleading, pleading, pleadings, indexing, esign, eSign, video_recording, video, oath, oath_video, profileOath, profile_oath, epayment, ePayment, e_payment, epayments, ePayments, epay_new, payment, payments, paymentGateway, payment_gateway, pay, courtfee, courtFee, court_fee, court_fees, wallet, courtFeeWallet, transaction(s), partner, partners, myPartners, my_partners, mypartners, favourite, favouriteClients, favourite_clients, manageClients, manage_clients, client(s), template, templates, useTemplate, my_templates, use_template, printVakalat, print_vakalat, vakalatnama, vakalath, profile, myprofile, my_profile, userProfile, planner, efiling_planner, case_planner, import, export, importCases, exportCases, objections, objection, objection_compliance, refiling, reFiling, refile, resubmit, defect(s), filing, filings, efiling, draft(s), mycases, my_cases, search_cases, custom_component, help, main, admin, case_registration, pde_registration, caveat, eCaveat, advocate, advocates, reports, report, notifications, settings, signup, registration_new, ia, IA, interlocutory, applications_new, esign_pleading, pleadingEsign, pleading_esign1, pleading_index1, pleading_new, upload, dashboard_new, dashboard1, litigant1, litigant_new, components1, common, custom, party, mycases_new, advocate_registration, litigant_registration.
`/pdedev/PDE/js/<n>.js` for: pde, PDE, litigant, newcase, case_filing, efile, mvc, fact, legal_heir, advocate_case_registration, main, custom, script, scripts, common, app.
`/pdedev/js/portfolio/<n>.js` for: mycases, portfolio, search_cases_new, import_cases, export_cases, add_case.

About 210 GET requests, spaced at least 0.5 s apart. Nothing else was requested.

### 0.3 Controllers seen in client code (`?p=<controller>/<method>`)
advocate_case_registration, custom_component, dashboard (also spelled `Dashboard`), applications, vakalat, upload_pleading, pleading_index, pleading_esign_test, videoRecording, registration, epay, portfolio, Portfolio (case), Portfolio_new, help, login, admin (logout only, CMP), otherPages (static pages, login.html).
Legacy non-route PHP (relative to the page): `../filing/autocomplete_section.php`, `../filing/fetch_sectioncode.php` (LIT:2586, 2612, inside commented or legacy `$.ajax` blocks).

---------------------------------------------------------------------------------------------------

## 1. Transport layer (applies to every endpoint) — CMP:214-333

* Every call is `POST {base_url}/?p={controller/method}` (CMP:265-266). `base_url` = value of hidden input `#base_url` (CMP:219). For the real site this is `/pdedev` **[inferred]** from LGN:98 and other absolute paths.
* Body is `application/x-www-form-urlencoded`: `postdata + '&ajax_req=true&__csrf_magic=' + token` (CMP:269). `token` = hidden `#__csrf_magic` (CMP:220).
* **The CSRF token changes after each request.** On success the new token is `result.nsteptoken` and is written back to `#__csrf_magic` (CMP:310). On HTTP error the body is `"<error message>#####<new token>"` (CMP:272-284). A headless client has to keep this chain going one request at a time (`async:false`, CMP:268).
* `dataType: json` by default (CMP:232-235).
* If `#hid_case_adv_pde` and `#hid_case_adv_flag` both have values, they are added to every request (CMP:258-260). This happens when you work on a case filed by another advocate.
* Response conventions:
  * `errormsg` present → `errorAlert(errormsg)` and the callback runs with `status=false` (CMP:297-303). **Quirk:** execution then continues, so the callback runs a second time with `status=true` (CMP:308-309). Callbacks guard against this with `if(!obj.errormsg && obj.status)`.
  * `msg` present → `successAlert(msg)` (CMP:304-307).
  * `status` is set by the client, not the server (CMP:308).
* Variants:
  * `ajaxCallNormal` (CMP:441): same, except the client does not force `status=true`.
  * `ajaxCallAct` (CMP:733): used for act autocomplete.
  * `ajaxCallNew(url, FormData, cb)` (CMP:945-1000): **multipart**; `ajax_req=true` is appended to the FormData. **No `__csrf_magic` is added**, so it must already be a field inside the form, e.g. `#frm_doc` **[inferred]**. Responses update the token the same way.
  * `ajaxCallreadPDF` (CMP:1059).
  * `jsonCall` (CMP:911): GET `?p=url&__csrf_magic=token`.
* Codes whose format is `"state~dist~est"`: values of `#selEstablishment` are split on `~` (CMP:248-256). District and taluka option values use `state~dist~natCode` (LIT:2326-2330, 2386-2390).
* Logout: `?p=login/logOut` (advocate) and `?p=admin/logout` (CMP:1498-1506).
* PDF viewing: `custom_component/readPdfFile` with `filePath` (CMP:1185-1190) and `custom_component/readDashboardPdfFile` with `filePath, docpath` (CMP:1174-1180). Both return `result.outputFile`, which is set as the `data` attribute of an `<object>`.

---------------------------------------------------------------------------------------------------

## 2. NEW CASE FILING (PDE wizard) — `litigant.js` + parts of `dashboard.js`/`components.js`

**Status: FOUND.** Every tab has its save endpoint and there is a final "eFile" endpoint. The `jquery.steps` initialisation is **not** in any public JS found. There are no `.steps(` calls in any downloaded file, so it is inline in the server-rendered page **[inferred]**. The tab navigation that the code does contain uses Bootstrap `.nav-tabs a[href="#tabN"]`.

### 2.1 Tabs / panes (DOM)
| Tab (manual name) | tab anchor id | pane href | summary-container on eFile tab | form id |
|---|---|---|---|---|
| Initial Inputs | (New Case tab `#tab_add`, edit `#edit_case_tab` / `#tab_edit`) | `#tab_add` / `#tab_edit` | — | `#frmInitialInput1`, `#frmInitialInput2`, `#frmSubordinate`, `#frmapplication_court` |
| Litigant | `#litigant_tab` | `#tab1` | `#litigant_tab1` | `#frmAdvParty` |
| Legal Heir | `#legal_heir_tab` (li `#li_legal_heir`) | — | — | `#frmAdvLegalHeirParty`, `#frmLegalHeirNot`, `#frmLegalHeirAdd` |
| Fact Details | `#fact_tab` | — | `#fact_detail_tab1` | `#frmAdvFact` |
| Case Details | `#case_detail_tab` (btn `#btnNextCaseDetail`) | `#tab2` [inferred from LIT:1259] | `#case_detail_tab1` | `#frmAdvCaseDetail` |
| MVC (only if `macp=='Y'`) | `#mvc_tab` (li `#liMVC`, summary `#id7`) | `#tab3` | `#mvc_tab1` | `#frmAdvMVC` |
| Subordinate court | `#subordinate_court_tab` | — | `#subordinate_court_tab1` | `#frmAdvParty` (sic, LIT:1459) |
| e-File | `#eFile_tab` | `#tab5` | — | — |
| Filed list | — | `#old_case` | `#submitted_pde` button | — |

State hidden inputs: `#adv_pde_no` (current temporary PDE no.), `#form_active_mode` (1=insert, 2=edit; LIT:73, 2865), `#form_action`, `#currunt_tab1`, `#tab_status`, `#hid_court_type` (1 = District Court, which triggers frmInitialInput1 validation; LIT:24-31), `#sel_party_type_no`, `#hid_case_adv_pde`, `#hid_case_adv_flag`, `#pde_no_value1/2`, `#get_pde_no_value`, `#read_pde_no_value`, `#hid_cino`.
Tabs are enabled by removing the `disabled` class (LIT:74, 1297-1302, 1421, 1468, 2981).

### 2.2 Cascading selects on Initial Inputs
| Step | Trigger | Endpoint | Params | Response → DOM | Source |
|---|---|---|---|---|---|
| State → District (tagged) | (in PSC) | advocate_case_registration/getTaggedDistrict/ | `selStateCode` | `obj.option` → `#selDistrict` | PSC:148-169 |
| District → Establishment | `getEstablishment()` (onchange of `#selDistrict`) [inferred binding] | custom_component/getDistrictEstablishmentByJSON/ | `fdistCode` = `#selDistrict`, `selState` = `#selTagState` | `obj.option` → `#selEstablishment` (values `state~dist~est`) | CMP:2242-2269 |
| Civil/Criminal radio → Main case type | `.rdoCivCrim` change, `input[name=fcasetype]` | advocate_case_registration/get_MainCaseType_data | `case_type` = fcasetype value | `obj.case_list` → `#selMainCaseType` (and clears `#selCaseType`) | LIT:1717-1747 |
| Main case type → Case type | `getSubCaseType()` | advocate_case_registration/getSubCaseType/ | `selMainCaseType` = `#selMainCaseType`, `civ_cri` = fcasetype | `obj.option` → `#selCaseType` | LIT:2819-2848 |
| Establishment/Bench → case types (application court) | `getApplicationCaseType()` | advocate_case_registration/getCaseTypes/ | `dist_code` = `#selDistrict`, `court_code` = `#selBench` if present, else `#selEstablishment` | `obj.option` → `#selSubCaseType2` if `errCode==0`, else alert `errMsg` | LIT:2851-2873 |
| Subordinate court case types | `getSubordinateCaseType()` | advocate_case_registration/getCaseTypes/ | `dist_code` = `#fsubdist_code`, `court_code` = `#selSubEstablishment` | `obj.option` → `#selSubCaseType1` | LIT:2875-2891 |
| High Court: HC + bench → case type | `getHcCaseType()` | custom_component/getHcCaseTypesByAPI/ | `high_court` = `#selTaggedHC`, `bench` = `#selBenchh` | `obj.option` → `#case_type` (`errCode/errMsg`) | LIT:1573-1601 |
| Case type → party labels | `setCaseLabel()` | advocate_case_registration/getPartyLabel | `case_type` = `#selCaseType` | callback not fully read (sets pet/res labels) [inferred] | LIT:2649-2709 |
| Lower-court case lookup | `searchPrevSubordinateCase()` | advocate_case_registration/getLowerCourtParties/ | `$('#frmSubordinate').serialize()` (fields include `fsubdist_code`, `selSubEstablishment`, `selSubCaseType1`, `fl_case_no1`, `fl_case_year1`, LIT:46-47) | `obj.option` → `#selMainPlaintiff`; `obj.decision_date` → `#flcdate_decision`; `obj.cino` → `#hid_cino`; `errCode/errMsg`; also `prayer`, `lprayer`, `macp` | LIT:2756-2789 |
| Application-court case lookup | `searchPrevApplicationCase()` | advocate_case_registration/getApplicatioCaseHistory | `dist_code` = `#selDistrict`, `court_code` = `#selEstablishment` + `$('#frmapplication_court').serialize()` | `obj.option` → `#selMainPlaintiff`, `obj.cino`, `obj.decision_date`, `errCode/errMsg` | LIT:2792-2800 |
| Party address: state → district | `getEstDistrict(this)` | advocate_case_registration/getEstDistrict/ | `selState`, `selOption` | `obj.option` → `#fdist_code1` / `#fdist_code3` (chosen by the select's id) | LIT:2279-2308 |
| district → taluka/town | `getEstTownTaluka(this)` | advocate_case_registration/getEstTownTaluka/ | `state_code`, `dist_code`, `distNationalCode` (split `~`), `selTaluka`, `selTown` | `obj.option` → `#ftaluka_code3` etc. | LIT:2318-2369 |
| taluka → village | `getEstVillage(this)` | advocate_case_registration/getEstVillage/ | `state_code`, `TalukaCode`, `talukaNationalCode`, `selVillage` | `obj.option` → `#fvillage_code3` etc. | LIT:2379-2407 |

### 2.3 Save endpoints per tab
| # | Tab | Function | Endpoint | POST body | Response fields used | Source |
|---|---|---|---|---|---|---|
| 1 | Initial Inputs → **creates the temporary PDE number** | `insertNewPDE()` | **advocate_case_registration/insertNewPDE/** | `selMainPlaintiff` (`#selMainPlaintiff`, or '') + `frmInitialInput1.serialize()` + `frmInitialInput2.serialize()`; if a subordinate court was entered, also `case_type_text` (text of `#selSubCaseType1`), `subordinate_court=1` and `frmSubordinate.serialize()` | **`obj.pde_no` → `#adv_pde_no`** (temporary e-filing/PDE number), `obj.macp` ('Y' shows MVC), `obj.pet_label`, `obj.res_label`, `obj.pre_case_act` (HTML → `#act_section`), `obj.total_count`, `obj.prev_party_list` (HTML → `#dropdown_content11`), `obj.prev_case_name`, `obj.prev_party_record{selCINO, selParty_type, selParty_no, pet_name, pet_gender M/F/T, pet_age, pet_address, lpet_address, lpet_name, org_id, state_id, petresDistrict, petresTaluka, petresVillage}` | LIT:19-211 |
| 2 | Litigant (add/update party) | `insertPartyInformationTab()` | advocate_case_registration/insertPartyInformationTab/ | `sel_party_type_no` + `frmAdvParty.serialize()` (the form contains `adv_pde_no`) [inferred] | `errorstatus`, `is_legal_heir`, `legal_heir_list`, `optlist` (→ `#dropdown_content10`), `total_party`, `optprevparty`, `total_prev_record`, `prev_case_name`, `pde_no` → `#adv_pde_no`, `case_header` → `#dvCaseHeader`, `party_tab` → `#litigant_tab1`, `pet_empty_flag` | LIT:435-576 |
| 2a | Litigant: edit one party | `editPDECaseParty(sel)` | advocate_case_registration/fetchPartyData/ | `sel_party_name` + `frmAdvParty.serialize()` | `extraparty_arr{name,lname,father_name,lfather_name,father_flag,name_salutation,pet_sex,pet_age,pet_dob,pet_caste,pet_email,pet_mobile,extra_inperson,extracount,legal_heir,performaresflag,org_type,regcase_type}`, `extraparty_add{address,laddress,pincode,state_id,petresDistrict,petresTaluka,petresVillage,petresWard,petresPoliceStation}`, `extraparty_info{occupation,loccupation}`, `extraparty_other_info{...}`, `extraparty_other_info1{country,nationality,passportno,panno,phone,fax,ph}`, `isFlagExtraPartyOtherInfo` | LIT:2027-2272 |
| 2b | Litigant: delete party | `delPDECaseParty()` | advocate_case_registration/delPDECaseParty/ | `party_type`, `party_no`, `fpde_no` | `optlist`, `total_party`, `legal_heir_list` | LIT:967-1024; DSH:983-1039 |
| 2c | Litigant: pick a party from the previous case | `editPDEPrevCaseParty(sel)` | advocate_case_registration/fetchPrevPartyData | `cino`, `party_type`, `party_no`, `adv_pde_no` | same shape as `prev_party_record` | LIT:214-224 |
| 3 | Legal Heir: list parties for pet/res | radio `pet_res` / `pet_res_legal_heir` change | advocate_case_registration/get_pet_res, …/get_pet_res_legal_heir | `pet_res_val`, `adv_pde_no` | `pet_res_list` → `#selpartyname` / `#selpartyname_legalheir` | LIT:3174-3215 |
| 3a | Legal Heir: mark dead party | `updateLegalHeir()` / `addLegalHeir()` | advocate_case_registration/update_legal_heir | `frmLegalHeirNot.serialize()` | `status1`, `msg`, `pet_res_list` | LIT:3224-3263 |
| 3b | Legal Heir: save heir | `insertPartyInformationTab_lh()` | advocate_case_registration/insertPartyInformationTab_lh/ | `form_action`, `sel_party_type_no`, `adv_pde_no`, `selpartyname_legalheir` + `frmAdvLegalHeirParty.serialize()` | `errorstatus`, `pde_no`, `case_header`, `party_tab` | LIT:359-426 |
| 3c | Legal Heir: list/edit/delete | — | advocate_case_registration/getLHPartyList (`adv_pde_no`, `sel_party`), …/fetchLHPartyData/ (`sel_party_name` + frmAdvParty), …/delPDE_LehalHeir/ (`party_type`, `party_no`, `fpde_no`) | — | LIT:313-330, 1803-2024, 3002-3051 |
| 4 | Fact Details | `insertFactTab()` | advocate_case_registration/insertFact/ | `adv_pde_no` + `frmAdvFact.serialize()` (inputs `.csFact`, `.csFactTime`, `.csFactDate`; at least one each; ids `fact_date1..n`) | `fact_details_tab` → `#fact_detail_tab1`; enables `#case_detail_tab` | LIT:2894-2998 |
| 4a | Add fact row | `add_more_fact()` | advocate_case_registration/getFactRow | `counter` | HTML row | LIT:3074-3087 |
| 5 | Case Details | `insertCaseInfo()` | advocate_case_registration/insertCaseInfo/ | `adv_pde_no` + `frmAdvCaseDetail.serialize()`; needs at least one `.csfdispactcode` (act) | `case_detail_tab`, `act_section_tab` → `#case_detail_tab1`; `macp`=='Y' → go to `#tab3` (MVC), else enable `#eFile_tab` and go to `#tab5` | LIT:1253-1311 |
| 5a | Acts/sections on load | click `#case_detail_tab, #btnNextCaseDetail` | advocate_case_registration/getCaseActSection | `adv_pde_no` | `act_section`, `prayer_detail` → `#frelief_offense`, `lprayer_detail` → `#flrelief_offense`, `errorcode` | LIT:1355-1370 |
| 5b | Default empty act box | `setDefaultActSection()` | advocate_case_registration/setDefaultActSection | (none) | `selBox` → `#act_section` | LIT:1375-1387 |
| 5c | Prayer template | `set_prayer()` | advocate_case_registration/fetchPrayerDetails/ | `prayer_id` = `#fprayercode_s` | `prayer_detail`, `lprayer_detail` | LIT:1319-1348 |
| 5d | Act autocomplete | jQuery-UI autocomplete | advocate_case_registration/getActs (`term`; also `stateCode`, `distCode`, `estCode` CMP:488) → `result.act`, `result.selectbox`; …/autocomplete_section (`term`, `national_code`=`#fhiddactcodes{flag}{no}`); …/fetch_sectioncode (`label`, `prevval`); …/fetchactsection (`no`, `val`, `cntnew`, `roleflag`, `flag`); …/getActSection/ (`actCode`) → array of `{actsection_code, act_section}` | — | LIT:2479-2624; CMP:154-211 |
| 6 | MVC | `insertMVC()` | advocate_case_registration/insertMVC/ | `adv_pde_no` + `frmAdvMVC.serialize()` | `mvc_tab` → `#mvc_tab1`; enables `#eFile_tab` etc. | LIT:1396-1435 |
| 7 | Subordinate court | `insertSubordinateCourt()` | advocate_case_registration/insertSubordinateCourt/ | `frmAdvParty.serialize()` | `subordinate_tab` → `#subordinate_court_tab1`; go to `#tab5` | LIT:1442-1474 |
| **8** | **e-File (final)** | **`submitEfileData()`** | **advocate_case_registration/submitEfileData/** | `pde_no` = `#adv_pde_no`, `page_data` = concatenated **raw (un-encoded) HTML** of `#litigant_tab1`, `#case_detail_tab1`, `#mvc_tab1`, `#subordinate_court_tab1` with `<p></p>` between them | `errorcode==1` → stop; `errorcode==2` → `error_tab` is a map of `tabId → …`, and those tabs are coloured red and the first is shown; otherwise go to `#old_case` and click `#submitted_pde` (refresh the filed list); `viewPDF` (unused, commented out) | LIT:1480-1540 |

There is a `confirm()` before the final submit: "Do you want to submit the case? Once submitted, case details can not be modfied." (LIT:1491). There is **no OTP, eSign or payment step inside the PDE wizard JS.** Court fee is paid separately via ePay. Pleadings are submitted later in Dashboard/submit_pleading (section 4.5).

### 2.4 Loading, listing and deleting drafts
| Function | Endpoint | Params | Response | Source |
|---|---|---|---|---|
| Draft cases list (Dashboard tile `#draft_cases`) | advocate_case_registration/getUnRegisteredPDE | `hide_show_action=1` | `pde_list` (HTML table `#example`) → `#history_body`, `total_record` | DSH:185-233 |
| Filed cases list (tile `#filed_cases`) | advocate_case_registration/getSubmittedPDE | (none) | `submitted_pde_list` (HTML `#example123`) → `#history_body`, `total_record` | DSH:149-172 |
| Open a draft | `fetchPDECaseData(pde_no, adv_flag)` → advocate_case_registration/fetchPDECaseData/ | `hid_case_adv_pde` = pde_no, `hid_case_adv_flag` | `macp`, `isCaseDetailFill`, `isMVCFill`, `legal_heir_count`, `legal_heir_list`, `lh_party_list`, `total_lh_party`, `case_header`, `pet_label`, `res_label`, `pet_empty_flag`, `tot_fact`, `fact_list`, `subcourt_arr`, `optlist`, `total_party`, `total_prev_party`, `prevoptlist`, `prev_case_name`, `party_tab`, `fact_details_tab`, `mvc_tab`, `subordinate_tab`, `case_detail_tab`, `act_section_tab`, `case_filed_by_adv`, `case_title` | LIT:613-870; DSH:700-931 |
| Delete draft | advocate_case_registration/deletePDECase/ | `fpde_no` | `pde_list`, `total_record` | LIT:876-915; DSH:939-975 |
| Delete submitted | advocate_case_registration/deleteSubmittedPDECase/ | `fpde_no` | `pde_list`, `total_record` | LIT:920-959 |
| Case filed by another advocate | advocate_case_registration/getCaseFiledBy | `case_type` (radio `rdoCaseFiled`), `selected_pde` = `#case_pde_no`; or `sel_advocate` (setBarReg) | `pde_list` → `#dvEditCase`, `total_record` | LIT:1620-1648, 3322-3355 |
| Case PDF | advocate_case_registration/generateCasePDF | `sel_pde` | `viewPDF` | LIT:3308-3319; DSH:1710-1720 |
| Case history PDF | advocate_case_registration/generateCaseHistoryPDF | `sel_pde`, `existing_case` Y/N | `viewPDF` | DSH:2117-2130 |
| Status of filed case in CIS | dashboard/getStatus | `est_code`, `pde_no` | `status1` (string; `'Still case is not consumed in CIS'` = not yet registered) → `#sts_spn_{pde}` / `#db_case_body` | DSH:1750-1790 |

### 2.5 Temporary e-filing number
* Created by `insertNewPDE` and returned as `obj.pde_no` (LIT:85). It is used in later calls as `adv_pde_no`, `pde_no`, `fpde_no`, `sel_pde_no`, `hid_case_adv_pde`.
* Its format is not shown in JS. Pleading-number examples in UPL:404-405 are `AMH20200000002D202200283`, where the first 14 characters are the e-filing UID (e.g. `AMH20200000002`) and characters 15-19 are the year (UPL:395, 1277-1278). So the e-filing UID looks like `<state 3 letters><est/year digits>…` **[inferred]**.

### 2.6 Open questions (New Case)
* The `name=` attributes inside the serialized forms (`frmInitialInput1/2`, `frmAdvParty`, `frmAdvCaseDetail`, `frmAdvMVC`, `frmAdvFact`, `frmSubordinate`) are server-rendered HTML and cannot be seen. The JS only shows the **ids** listed above. A headless browser that fills fields by id and lets the page serialize them avoids this problem.
* `jquery.steps` configuration and button → function bindings (`onclick="insertNewPDE()"` etc.) are in server HTML **[inferred]**.
* How `#selDistrict` is first filled in New Case (it may be server-rendered, or come from `getTaggedDistrict` as in PSC).

---------------------------------------------------------------------------------------------------

## 3. PLEADINGS — `upload_pleading.js` (main), `pleading_index.js`, `pleading_esign.js`, `pleading_esign_test.js`

### 3.1 Screen selectors
* Case source radio `name=cases` (UPL:118-124, 821): `3` = e-filed (PDE) → `#sel_pde_no`; `1` = existing case → `#txt_case_search` (CNR); `#search`, `#eFiled` and `#regis` are the radio ids (UPL:70-75). The index/eSign tabs use `name=search_case` (UPL:1353).
* Tabs: `#pleading_index_tab` (UPL:82), `#pleading_esign_tab` (UPL:93). `#esigned=='Y'` → open the eSign tab automatically (UPL:104-109).
* Form `#frm_doc`: `#file_name` (title, required), `#doc_file_name` (file input, required) (UPL:5-29); `#merge_txt`, `#merge_file_cnt`, `#newfilesadded`, `#case_cino`, `#selDocType` (MACP doc type, optional), `#macpfiletype` (JSON). `#upload_pdf_name` is the list of uploaded files; `#add_btn` is "Add".

### 3.2 Endpoints
| Step | Endpoint | Method/encoding | Params | Response | Source |
|---|---|---|---|---|---|
| List pleadings for case | upload_pleading/fetchPleadingData | urlencoded | `column_cnt=2`, `type_of_case` (cases radio), `sel_pde_no`, `hid_cino` (CNR) | DataTables payload `fnCallback1` (tables `#extable_wrapper`, `#newtbl_wrapper`, `#tbd_example1`) | UPL:811-849 |
| **Upload one file** (`#add_btn`) | **upload_pleading/addFile** | **multipart** (`ajaxCallNew`) | `FormData(#frm_doc)` (so it includes `file_name`, `doc_file_name`, …) **+ `file`** (= `#doc_file_name.files[0]`) + `sel_pde_no`, `case_cino`, `merge_file` (= `#merge_file_cnt`), `filesadded` (comma list of original names) | `errormsg`, `status`, `fileNameNew` (server name, pushed to `#newfilesadded`), `signed_flg` ('Y' = digitally signed PDF detected), `pleading_number` | UPL:114-260 |
| Remove uploaded file | upload_pleading/removeFile | urlencoded | `file_name` (+ `cino_pde_no` in second variant) | `id` | UPL:450-464, 556-569 |
| **Merge** files into one pleading | **upload_pleading/mergedocSubmit** | multipart | `FormData(#frm_doc)` + `addedfiles` (ids of `.pdfview` elements, or `uid/year/file`), `myfiles` (newfilesadded), `file_title` (= `#merge_txt`, required) | then refreshes list | UPL:395-439 |
| **Submit pleading data** | **upload_pleading/addData** | urlencoded | `#frm_doc.serialize()` + `pet_res_name` (checked `chk_pet_list[]` + `chk_res_list[]` joined by `#`), `est_name` (text of `#selEst`), `filesadded`, `fil_type` (`#hid_filcase_type`, default 0), `fil_no` (`#hid_fil_no`), `fil_year` (`#hid_fil_year`), `efiling_case_type` (`#hid_regcase_type`), `maincase_type` (`#hid_maincase_type`), `sel_pde_no`, `case_cino`, `merge_file`, `merge_txt`, `txtfilename` | `status` → refresh | UPL:640-750 (line 723 has the full string) |
| Signed-party picker | upload_pleading/get_advocate | urlencoded | `file_name`, `cases`, `sel_pde_no`, `txt_case_search` | `val` | UPL:508-520 |

**File checks done in the browser (UPL):**
* The title (`#file_name`) must match `^[a-zA-Z0-9 _]+$` (UPL:153); the blur handler is stricter, `^[a-z0-9_]+$`, cannot start or end with `_`, has at most 5 underscores, and cannot be all underscores (UPL:30-66, 135-143).
* **There is no size or type check.** The size is computed (`fileSize` KB, UPL:167) but never compared. The `.pdf` extension check is commented out (UPL:160-164). PDF-only is implied by the `.pdf` naming everywhere, and limits are enforced on the server **[inferred]**.
* At least one file must be added before addData (UPL:640-644).

### 3.3 Indexing (bookmarks)
| Step | Endpoint | Params | Response | Source |
|---|---|---|---|---|
| Index list | pleading_index/fetchPleadingData | `hid_pde`, `chkFlag` | DataTables | UPL:888-898 |
| Add index entry | pleading_index/documentIndex | `$('#frm_doc_index').serialize()`: `#selDocument` (pleading), `#index_title` (required), `#from_page_no`, `#to_page_no` (>0, from ≤ to), `#mrg_flag` | `status` | UPL:991-1038 |
| Delete index entry | pleading_index/deleteIndex | `pleading_number`, `pleading_number_sr_no` | `option` | UPL:1508-1515 |
| Document picker | pleading_index/fetchDocument (`frm_doc` serialized, or `cino`, or `sel_pde_no`+`search_case`), pleading_index/getSelectBox | — | `option`, `flag` | PIX:5-38, 80-86; PES:7-88 |
| Old index call | pleading_index/index | `frm_doc` serialized (commented out) | `status` | UPL:753-760 |

### 3.4 Authorisation + eSign (`pleading_esign_test` controller)
| Step | Endpoint | Params | Response | Source |
|---|---|---|---|---|
| eSign list | pleading_esign_test/fetchPleadingData | `hid_pde`, `chkFlag` (+ `sel_advocate`) | `option`, `status` | UPL:1042-1051, 1525-1534 |
| Choose who signs (popover `#auth_{pleading}`) | pleading_index/fetchAdvLit | `pleading_number`, `cases` (search_case radio), `sel_pde_no`, `txt_case_search` | `adv_option`, `lit_option` (HTML checkboxes `.chk_adv{N}` / `.chk_lit{N}` plus radios `aesigotp[i]` / `lesigotp[i]` = eSign vs OTP) | UPL:1349-1400 |
| **Save authorisation** | **pleading_index/submitAuth** | `pleading_number`, `advchk` (#-joined), `litchk`, `aesigotp` (#-joined choice per advocate), `lesigotp` (per litigant) | `status` → refresh eSign list | UPL:1420-1496 |
| **eSign (Aadhaar eSign gateway)** — "I accept" modal `showFrame()` → `showEsignFrame()` | **pleading_esign_test/esign_trans** | `filename` (pleading_number), `sessdirname` (`#state_user`), `foldername` (`#foldername`), `sign_counter`, `page_created`, `party_adv_name` (HTML of `#dv_{pleading}`, URI-encoded), `username`, `esign_url` (`#esign_url`) | `obj.url` → `<object id=pdfframenew data=…>` (the ESP/CDAC eSign page shown in a frame), `obj.dir_month`; the user completes Aadhaar OTP **on the ESP page, not here** | UPL:1094-1135, 1153-1158 |
| OTP-authentication instead of eSign — modal `#verifyMsg` (`showEsignFrame1`) | **pleading_esign_test/sendOTP** | `mobile` (`#mobile`, 10 digits), `hidcasseno` (`#hiddencasseno`) | `errormsg` containing "after 2 minute" → 2-minute lockout | UPL:1137-1205 |
| | **pleading_esign_test/verifyOTP** | `mobile`, `otp` (`#otp`), `pleading_number`, `role`, `user_name`, `user_details` (hidden inputs set by showEsignFrame1) | `msg1` = error (5 attempts, then 2-minute lock); `msg` = success → the cell shows "OTP Authenticated" | UPL:1209-1263 |
| Older/test variant | the legacy eSign JSP was at `http://10.153.16.219:8080/Esign_Client_Profile/index1.jsp?filename=` (internal IP, dead code); pleading_esign_test/fetchDetails (`sel_pde_no`, `search_case`, `doc_id`); pleading_esign_test/selfInvoker (video upload test) | — | — | PET:34-77, 1193-1209 |
| PDF preview | custom_component/readPdfFile | `filePath` = `#sessionJSONDir` + `/pleading_documents/{uid}/{year}/{pleading}.pdf` (if `#server_addr=='13'`) | `outputFile` | UPL:1266-1290 |

### 3.5 Final pleading submission (from Dashboard "Draft Pleadings")
| Step | Endpoint | Params | Response | Source |
|---|---|---|---|---|
| Draft pleadings list (tile `#efiling_activity`) | dashboard/fetchActivities | `''`, or `numrow`, `pagenum`, `searchterm` (`#txtSearchByCaseName`) | `submitted_pde_list` (HTML `#example1`), `total_record`, `application_count`, `document_count` | DSH:253-291, 1996-2037 |
| **Submit pleading to court** | **Dashboard/submit_pleading/** | `unique_id`, `type_of_case`, **`grn`** (value of the input whose id is `unique_id`, i.e. the GRN dropdown for that row), `efiling_number` | `status` → reload list. An empty GRN brings up a confirm "submit without court fee?" | DSH:1669-1691 |
| Re-submit (after objection) | Dashboard/resubmit_pleading/ | `efiling_number` | `status` → click `#completed_pleading` | DSH:1694-1707 |
| Completed pleadings (tile `#completed_pleading`) | dashboard/fetchCompletedActivities | same as fetchActivities | same | DSH:304-336, 2065-2095 |

---------------------------------------------------------------------------------------------------

## 4. VIDEO OATH — `videoRecording.js`
| Step | Endpoint | Params | Response | Source |
|---|---|---|---|---|
| PDE numbers for advocate | videoRecording/fetchPDENumbers | `sel_advocate` | `pdeoption` | VID:47-53 |
| Document/select list | pleading_index/getSelectBox | `sel_pde_no`, `search_case` | — | VID:63-68 |
| List oath videos | videoRecording/fetchOathVideos | `sel_pde_no`, `search_case` | DataTables | VID:83-87 |
| Upload recorded oath | **videoRecording/selfInvoker** (or **registration/profileOath** when `#form_type=='P'`, i.e. profile oath) | multipart: `video-filename`, `video-blob` (WebM from RecordRTC), `search_case`, `sel_pde_no`, `selDocument`, `selClient` (`#selClientList`) | reload | VID:1313-1379 |
| Play | videoRecording/readOathVideo | `filepath` | `contents` / `outputFile` | VID:127-132; DSH:1645-1654 |
| Details | videoRecording/fetchDetails | `sel_pde_no`, `search_case`, `doc_id` | — | VID:165-174 |
| Dashboard oath list | dashboard/fetchOathData | `column_cnt=2`, `type_of_case`, `sel_pde_no`, `hid_cino`, `dashboard=Y` | DataTables | DSH:1394-1402 |

---------------------------------------------------------------------------------------------------

## 5. ePAYMENT — `epay.js` (controller `epay`)

### 5.1 Screen
* Case source radios `name=cases` / `search_case`: `#search` (1 = case number / CNR), `#regis` (2 = registered), `#eFiled` (3 = e-filed PDE → `#sel_pde_no`) (EPY:238-330, 571, 708).
* Payment type radios `name=epayOptions`: court fee (`#courtFee_radio`), `JD` judicial deposit (`#jd_type`, select `#judicial_type`), `F` fine (`#scheme_div`, `#scheme_code` / `#scheme_code2`), `O` other (`#other_pay_type`, `#sub_payment_type`), penalty. Labels `#courtFeeLabel`, `#JudicialDepositLabel`, `#penaltyLabel`, `#FineLabel`, `#othersLabel` (EPY:194-218).
* Fields: `#payee` (party select, value `type~party_no`), `#extraparty` (free-text payee), `#mobile`, `#amount`, `#Amount_lbf`, `#Amount_awf`, `#Amount_acwf` (welfare-fund amounts), `#Remark`, `#user_otp1`, `#div_otp`, `#div_redirect`; hidden `#hid_establishment_code`, `#hid_state_code`, `#hid_dist_code`, `#hid_cino`, `#hid_regcase_type`, `#hid_reg_no`, `#hid_reg_year`, `#hid_filcase_type`, `#hid_fil_no`, `#hid_fil_year`, `#hid_maincase_type`, `#sess_state_code`, `#selComponentDistrict`, `#selComponentEst`, `#displayCaseNocase`. Form `#frm`.

### 5.2 Endpoints
| Step | Endpoint | Params | Response | Source |
|---|---|---|---|---|
| Payment types for est. (after CNR chosen `#txt_case_search`) | epay/get_establishmentwise_payment_type | `est_code`, `state_code` | `court_fee`, `judicial_deposit`, `penalty`, `fine`, `other_fee` ('Y'/'N') | EPY:171-220 |
| Payment types (default) | epay/get_payment_type | — | same flags | EPY:1765-1812 |
| Parties of PDE | epay/getPartyListFromPDE | `pde_no` (`#sel_pde_no`) | `party_options` → `#payee`, `pde_est_code`, `cino` | EPY:472-490 |
| Party mobile | epay/getMobile | `pde_no`, `party_no` | `mobile` → `#mobile` | EPY:496-530 |
| Schemes / JD types | epay/fillScheme_jd | `state_code`, `existingcase`, `cino`, `ci_cri`, `dist_code`, `national_court_code`, `epayOptions`, `action_code=fillScheme_jd` | `fill_Scheme` (`$`-separated), `fill_JudicialType`, `fillPaymentType` | EPY:1267-1400 |
| JD type list | epay/fillJudicialType | `state_code` or `cino`, `cnrradio`, `ci_cri`, `action_code` | `data` | EPY:1441-1472 |
| Amount check | epay/chk_amount | `action_code=chk_amount`, `state_code`, `amount`, `epayOptions`, `cnr_no` | `msg` (error text → `#errSpan1`) | EPY:1853-1880 |
| **Send OTP** | **epay/generate_otp** | `mobile`, `amount`, `epay_type`, `case_num`, `case_type`, `case_year`, `search_case` | `status=="success"`, `msg`; shows `#div_otp` | EPY:559-660 |
| **Verify OTP + create payment** | **epay/verify_otp_new** | `mobile`, `user_otp`, `state_code`, `dist_code`, `national_court_code`, `Amount`, `CHALLAN_AMOUNT`, `Amount_lbf`, `Amount_awf`, `Amount_acwf`, `party_name`, `party_no`, `Remark`, `epay_type`, `case_sel` (`cnr`/`New`), `scheme_code`, [`judicial_type` if JD], [`payment_type` if O], case number fields (`case_type`, `case_no`, `case_year`, `case_type_name`, `cino`) **or** (for PDE) `cino`, `hid_regcase_type`, `hid_reg_no`, `hid_reg_year`, `hid_filcase_type`, `hid_fil_no`, `hid_fil_year`, `hid_maincase_type`; then `casedetail`, `sel_pde_no`, `search_case_type`, `action_code=verify_otp_new` | `msg` "Please Regenerate One Time Password" → reset; otherwise **`result.data` HTML is injected into `#div_redirect`**. This is the gateway hand-off: a server-built form or redirect to the state treasury / SBI ePay / pay.ecourts.gov.in **[inferred, the form itself is not in the JS]**. A `confirm()` appears if amount ≥ 100000 | EPY:699-994 |
| Transactions list | epay/DoubleVerificationDetails | `action_code=viewTransaction` | `data` HTML → `#divTransList` | EPY:998-1032 |
| **Get GRN** (per row) | epay/getGRNGras | `state_code`, `pde_transaction_id`, `pay_from`, `payment_type`, `national_court_code`, `other_fee_sub_code`, `action_code=getGRNGras` | `data` = `"GRN~CIN"` → `#grn_{cnt}`, `#cin_{cnt}` | EPY:1040-1087 |
| Get bank CIN | epay/getCINGras | `pde_transaction_id`, `state_code`, `national_court_code`, `payment_type`, `pay_from`, `other_fee_sub_code`, `action_code=getCINGras` | `data` = `"GRN~CIN"` | EPY:1093-1134 |
| Double verification | epay/viewDetailsDouble | `pde_transaction_id`, `merchant_order_no` | `url` → opened in a new tab | EPY:1140-1185 |
| SBI double verification | epay/viewSBIDetailsDouble | `mechant_order_no` (sic), `cino`, `epay_type`, `action_code=doubleVerification` | `data` → `#encryptQuery`, which is posted to `https://test.sbiepay.com/secure/AggMerchantStatusQueryAction` (commented out) | EPY:1190-1202 |
| SBI OTP | epay/get_otp_sbi (`MerchantOrderNo`, `action_code=get_otp`), epay/encrypt_otp (`user_otp` → `encotp`) | — | — | EPY:1220-1252 |
| Challan / receipt | epay/getChallanData (`department_id`, `pay_type`, `other_fee_sub_code`, `vendor`; **bug: passes `senddata` not `postdata`**), epay/getPrevChallanGras (`grn`, `department_id`, `vendor_name`) | — | `data`, `url`; receipt PDF at `EPAY_NFS_URL + /challan_alias/{folder}/{grn}.pdf` (folder per state vendor: MG_Challan, Assam_Challan, MN_, TR_, STOCK_, HR_, WB_, BR_) | EPY:1503-1690 |

**GRN usage:** the GRN goes back into eFiling through Dashboard/submit_pleading (`grn` param, DSH:1673-1681) and Applications pay-fees (section 6).

---------------------------------------------------------------------------------------------------

## 6. APPLICATIONS (IA) — `applications.js`
| Step | Endpoint | Params | Response | Source |
|---|---|---|---|---|
| Find case (existing case) | applications/getCaseNumberComponent/ | `fsubdist_code`, `selSubEstablishment`, `selSubCaseType1`, `fl_case_no1`, `fl_case_year1`, `filing_type1` | `errCode`, `option_pet` → `#case_pet_list`, `option_res` → `#case_res_list`, `case_title` → `#case_main_party_title`, `hidden_field` → `#dv_hidden_case_field`, `case_data` (JSON), `cino` → `#case_cino`, `table`, `total_party` | APP:395-440 |
| My cases by next date | applications/getMyCases | `dt_next_date` | `total_party` … | APP:445-453 |
| Application type → preamble/prayer | applications/getPrayerPreamble | `selApplication` (`#application_type`) | HTML paragraphs (`#txt_preamble`, `#txt_prayer`, `#txt_para1`, `.csExtraPara`) | APP:308-316 |
| **Submit application** | **applications/submitApplication** | `$('#frmapplications').serialize()`; the client requires a client checkbox (`.chk_pet` for cases=1, or `.selcase` + `.csClient` for cases=4); `#hidden_edit` 2 = update (then re-authentication is needed and paid fees go back to the wallet) | `status` | APP:503-557 |
| Edit / delete draft | applications/editApplication, applications/delApplication | `selApplication` | `status` | APP:122-155 |
| Refresh connected est. | applications/refreshConnEst | — | → `#tr_my_case` | APP:604-607 |
| Pay-fees list | applications/getSubmittedCasesPayFees | `page`, `limit`, `txtAppSearch` | HTML | APP:614-625 |
| **Pay court fees (from wallet)** | **applications/payCourtFees** | `$('#frm_epay_submission').serialize()` (rows `.chkEstApp`, `#rem_bal_*`, `#sp_sub_total_*`); confirm | `status` → reload | APP:742-761 |
| Search submitted | applications/searchSubmittedApplication | `frm_submitted_application` serialized | — | APP:766-770 |
| Authentication list | applications/getMySubmittedCases | `frmotpsubmission` serialized + `page`, `limit` | — | APP:820-829 |
| **Auth OTP send** | **applications/generateOTPForAuthentication/** | `user_mobile` (`#hidden_user_mobile`), `hidden_pde_cnr_serial_no`, `hidden_signed_by_adv_lit`, `hidden_sign_sr_no`, `hidden_litigant_party_id`, `user_name` (`#user_name` html), `hidden_sel_application_count` | `errormsg` "after 2 minute" → 2-minute lock | APP:1197-1250 |
| **Auth OTP verify** | **applications/verify_otp/** | `user_mobile`, `mobile_otp` (`#user_otp`), `hidden_pde_cnr_serial_no`, `hidden_signed_by_adv_lit`, `hidden_sign_sr_no`, `hidden_litigant_party_id`, `user_name` | `msg1` = error (5 attempts); on success → `submitFinalData()` | APP:1256-1309 |
| **Final submit** | **applications/submitFinalData** | `$('#frmotpsubmission').serialize()` (or `#frmotpsubmission1` in the "filed by advocate" variant) | `status` → hide `#vw_otp_modal` | APP:882-900, 1312-1352 |
| Filed by advocate | applications/getApplicationFiledByAdvocate(/) | `selected_pde` or `sel_advocate` | `table`, `tot_record` | APP:919-936, 1392-1434 |
| Prayer data / view | applications/getPrayerPreambleData (`application_serial`, `app_id`, `pet_called_as`), applications/getApplicationOfUser | — | `flag`, `outputFile` | APP:1069-1076; DSH:502-640 |
| Dashboard IA lists | dashboard/fetchDraftIA, dashboard/fetchCompletedIA (no params) | — | `submitted_pde_list`, `total_record` → `#history_body` | DSH:349-432 |
| IA data per case | applications/fetchApplicationData | `column_cnt=2`, `type_of_case`, `sel_pde_no`, `hid_cino`, `dashboard=Y` | `tbl` | DSH:1360-1368 |

---------------------------------------------------------------------------------------------------

## 7. VAKALATNAMA — `vakalat.js`
| Step | Endpoint | Params | Response | Source |
|---|---|---|---|---|
| District → establishments | vakalat/fetchEst | `dist_code` | `establishments` → `#est_code` | VAK:352-373 |
| Establishment → case types | vakalat/connectEst | `stateCode`, `distCode`, `estCode`, `courtCode` | `casetypes` → `#case_type` | VAK:405-420 |
| Load case parties | vakalat/fetchData | `str=1` (case number): `stateCode`, `distCode`, `estCode`, `courtCode` (from `#selComponentEst` split `~`), `case_type`, `case_no`, `case_year`, `str`; or by CNR: `cnr` (`#hid_cino`); or `str=3`: `sel_pde_no`, `str` | `adv_option` → `#advocate`, party options → `#litigant`, `#pde_no_row` | VAK:426-520 |
| Advocate search | vakalat/fetchAdvocate | `adv_name` | `adv_option` | VAK:596-633 |
| User by mobile | vakalat/getUser | `mobile_no` | `usrOptions` → `#sel_party_mobile{b}` | VAK:268-300 |
| **Send OTP** | **vakalat/sendOTP** | `cnr` (`#cnr`), `litigant` (`#litigant`); or `flg=A` (advocate approval, needs `.chk_adv_approve` checked) | — | VAK:667-690 |
| **Verify OTP** | **vakalat/verifyOTP** | `cnr`, `litigant`, `otp` (`#otp`) | `status`; `errormsg` → clear `#otp` | VAK:697-745 |
| **Submit** | **vakalat/submitData** | `$('#frm').serialize()` + `flg` (`L` when `#sessionUserType==2`, i.e. litigant) + `cause_title` = `#pet_name` html + " Vs " + `#res_name` html + `lcause_title` | `msg` | VAK:750-940 |
| List | vakalat/fetchLitigantData (DataTables server-side) | `type_of_case`, `search_1..n`, `column_cnt` + DataTables params | — | VAK:1000-1050 |

---------------------------------------------------------------------------------------------------

## 8. DASHBOARD — `dashboard.js`
| Tile / action | Endpoint | Params | Response | Source |
|---|---|---|---|---|
| My cases panel | Portfolio_new/my_cases (ajaxCallNormal) | `header_view=N` | HTML | DSH:93-102 |
| Draft cases | advocate_case_registration/getUnRegisteredPDE | `hide_show_action=1` | `pde_list`, `total_record` | DSH:185-233 |
| Filed cases | advocate_case_registration/getSubmittedPDE | — | `submitted_pde_list`, `total_record` | DSH:149-172 |
| Draft pleadings | dashboard/fetchActivities | `''` / `numrow`, `pagenum`, `searchterm` | `submitted_pde_list`, `total_record`, `application_count`, `document_count` | DSH:253-291, 1996-2037 |
| Completed pleadings | dashboard/fetchCompletedActivities | same | same | DSH:304-336, 2065-2095 |
| Draft IA / Completed IA | dashboard/fetchDraftIA, dashboard/fetchCompletedIA | — | `submitted_pde_list`, `total_record` | DSH:349-432 |
| **Objections** (tile) | **dashboard/fetchObjections** | — | **`table`** (HTML `#tblFavClient`) → `#history_body`, `total_record` | DSH:445-479 |
| CIS status of PDE | dashboard/getStatus | `est_code`, `pde_no` | `status1` | DSH:1750-1790 |
| Existing-case status | dashboard/getExistingCaseStatus, …/getExistingCaseStatusDetails | `est_code`, `cino` | `status1`, `application_count`, `fee_count`, `oath_count` | DSH:1798-1850 |
| CNR history | dashboard/getCINOHistory | `cino` | `status1`, `pleading_table`, `application_table`, `fee_table`, `oath_count` | DSH:1896-1899 |
| My documents | dashboard/getMyDocument | `cino` | `status1`, `case_history` | DSH:1906-1968 |
| Case history modal | Portfolio/getCaseHistory (Normal) | `cino1`, `language_flag`, `bilingual_flag` (`#sessionlangid`), `selected_court`, `header_view=N` | HTML | DSH:1723-1732 |
| Calendar litigants | portfolio/getAllLitigants/ | `selecteddate` | `existing_cases[]` | DSH:1086-1114 |
| Labels | portfolio/getAllLabelsData/ | `language` | `allLabels` | DSH:1046-1057 |
| Practice-location onboarding overlay (`#jan_updated_overlay`) | dashboard/get_high_courts (`get_state_census` = state part of `#jp_state_code`), dashboard/jp_getEstStateDistrict (`selState`) → `#jp_dist_code`, dashboard/get_bench (`sel_high_court`) → `#sel_bench`, **dashboard/save_practice_location** (`state`, `district`, `highcourt`, `court_type` radio, `bench`) → `status1=='success'` | — | `res.option`, `status1`, `message` | DSH:2300-2452 |

---------------------------------------------------------------------------------------------------

## 9. PORTFOLIO (My Cases / search) — summary
* Search (PSC): portfolio/getEstablishment/ (`fstateCode`, `fdistCode`, `selStateCode`), portfolio/getCaseTypes/ & getPoliceStation/ (`dist_code`, `court_code` = `#selEstSearchCases`, `bilingual_flag`, `selected_court`), getCaseNumber/ (`case_type`, `case_no`=`#search_case_no`, `case_year`=`#rgyear`), getByPartyName/, getByAdvocate/, getByCaseType/, getByAct/, getActType/, getFilingNumber/, getByPoliceStation/, getByCaveat/, getBench/, advocate_case_registration/getTaggedHCBench/, portfolio/listOfCasesWebService/ (`cino1`), checkCaseExistsInMyCases/ (`cino`), **portfolio/addCase/** (`historyArr` JSON, `petResArr`, `petResAdv`, `petResNameArr`, `lpetResNameArr`, `petResMobile`, `petResMobileArr`, `selected_court`), caveat endpoints, getViewBusiness/, getWritInfo/ (PSC:54-1983).
* My cases (MCF/MYC): portfolio/getMyCasesData/ (`configuration`=sessionStorage SELECTED_COURT), insertIntoMyCases/, updateIntoMyCases/ (`casesImported`, `configuration`), refreshMyCases/ (`cnr_numbers`, `action_code=list`, `version_number`, encrypted language flags), deleteMyCases/, getRepresentingForCinos/, getCaseHistory/, getFilingCaseHistory/, removecase/ (`cino`), getTimeStamp/, updateRefreshTimeStamp/, custom_component/get_my_cases_1 (`term`), advocate_case_registration/getAdvocate (MCF:7-206; MYC:30-1868).

---------------------------------------------------------------------------------------------------

## 10. Not covered / open questions
1. **Server-rendered HTML for logged-in pages.** All form `name=` attributes inside serialized forms, the `jquery.steps` config, and the onclick bindings that call these functions live in server-rendered HTML, which is not public. The ids above are the ones the JS reads or writes.
2. **Payment gateway hand-off.** `verify_otp_new` returns HTML (`result.data`) that is injected into `#div_redirect`. Its contents (auto-submit form, target URL, GRN/merchant fields) are built on the server and are not visible. No `pay.ecourts.gov.in` string appears in any public JS.
3. **eSign.** `esign_trans` returns `obj.url`, a page from the eSign service provider, shown in an `<object>`. The Aadhaar OTP happens there. The callback path after signing is unknown; the page reloads with `#esigned=='Y'` (UPL:104) **[inferred]**.
4. **No public JS was found for:** court-fee wallet, partners/favourite clients/manage clients, templates/use template/print vakalat, profile, planner, import/export (beyond MCF's import helpers), caveat filing, objections compliance screen (only the dashboard list `fetchObjections`), registration (`registration.js` is 404; only `registration/profileOath` is referenced).
5. Server-side limits (file size and type, OTP rate limits beyond "after 2 minute", 5 OTP attempts on the client) are only partly visible.
6. CSRF token chaining (`__csrf_magic` / `nsteptoken`) means requests cannot run in parallel within one session.
