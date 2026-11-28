# 🤖 Postman Collection Maintenance - Quick Reference for Agents

**TL;DR:** Keep the Postman collection complete and representative of all NaviFS API capabilities.

## ⚡ At a Glance

| Aspect | Requirement |
|--------|-------------|
| **Coverage** | Every API endpoint must have ≥1 request |
| **Completeness** | All parameters, formats, headers must be tested |
| **Organization** | Grouped by use case (not alphabetical) |
| **Updates** | When API changes, collection must change |
| **Versioning** | Semantic versioning (MAJOR.MINOR.PATCH) |

## 🚀 When You Should Update the Collection

✅ **Always update when:**
- New endpoints added to API
- New query parameters introduced
- New response formats/types supported
- New error codes documented
- Authentication changes
- New resource types in config.yaml examples
- API behavior changes

❌ **Don't update if:**
- Only fixing typos in collection names
- Only updating comments/descriptions (minor docs)
- Internal refactoring with no API change

## ✅ Collection Completeness Checklist

### GET Requests Need:
- [ ] Basic request (no params)
- [ ] All `type` format options (json, text, html, xml, csv, yaml, toml, stream)
- [ ] `cursor` parameter variations (if applicable)
- [ ] `recursive=true` variant (if applicable)
- [ ] HEAD request variant
- [ ] OPTIONS request

### POST Requests Need:
- [ ] Basic write request
- [ ] `encoding` parameter variants
- [ ] Nested path write (e.g., `cursor=subdir/file.txt`)

### DELETE Requests Need:
- [ ] File deletion
- [ ] Directory deletion with `force=true`

### Error Scenarios Need:
- [ ] 401: Invalid/missing API key
- [ ] 403: Path traversal attempt
- [ ] 404: Non-existent resource
- [ ] 400: Invalid parameters
- [ ] 413: Oversized payload (if applicable)
- [ ] 416: Unsatisfiable range (if applicable)

### Headers & Auth Need:
- [ ] `x-api-key` on protected endpoints
- [ ] `Content-Type: text/plain` on POST
- [ ] `Range` header for partial content
- [ ] Conditional headers (If-Modified-Since, If-None-Match)

## 🛠️ Update Procedure

```bash
# 1. Review API changes
grep -n "^## " README.md | grep -i "endpoint"

# 2. Edit the Postman collection JSON
# Add new requests following existing patterns

# 3. Validate JSON
jq empty NaviFS-API-Collection.postman_collection.json

# 4. Update this README
# - Change request count in "Included Requests"
# - Add new requests to list
# - Update version number
# - Change "Last Updated" date

# 5. Test in Postman
# - Import updated collection
# - Run a few requests to verify variables work
```

## 📐 Naming Convention

```
{METHOD} {resource} - {description}

Examples:
- GET test-file - Basic read
- GET test-directory - Recursive Listing
- POST test-directory - Create/Write File
- DELETE test-directory - Delete Single File
- HEAD test-file - Check Headers
- OPTIONS test-directory - Allowed Methods
```

## 🔢 Version Bumping

- **MAJOR** bump: Adding/removing entire endpoint categories
- **MINOR** bump: Adding new requests or query parameter variants
- **PATCH** bump: Fixing existing requests or docs

**Example:**
```
1.0.0 → 1.1.0  (added 3 new requests for execute endpoint)
1.1.0 → 2.0.0  (removed deprecated write operations)
1.0.0 → 1.0.1  (fixed Range header format)
```

## 📝 JSON Request Template

```json
{
  "name": "GET resource - Description",
  "request": {
    "method": "GET",
    "header": [
      {
        "key": "x-api-key",
        "value": "{{master-api-key}}",
        "type": "text"
      }
    ],
    "url": {
      "raw": "{{baseUrl}}/api/v1/resource?param=value",
      "host": ["{{baseUrl}}"],
      "path": ["api", "v1", "resource"],
      "query": [
        {
          "key": "param",
          "value": "value"
        }
      ]
    },
    "description": "What this request tests and what response to expect"
  },
  "response": []
}
```

## 🔗 Files to Check When Updating

| File | Why |
|------|-----|
| `README.md` | Source of truth for endpoints |
| `config.example.yaml` | New resource types/configs |
| `config.yaml` | Current test resources |
| `test/**` | What tests verify |

## ⚠️ Common Mistakes to Avoid

❌ Don't:
- Add requests for every minor parameter combo
- Create duplicate requests across different folders
- Use hardcoded values instead of `{{variables}}`
- Forget to test error cases
- Leave collection incomplete when API changes

✅ Do:
- Group requests by practical use case
- Reuse common patterns and variables
- Document why each request exists
- Test both success and failure paths
- Keep collection updated with API

## 🧪 Validation Checklist Before Committing

- [ ] JSON is valid: `jq empty NaviFS-API-Collection.postman_collection.json`
- [ ] Request count matches folder descriptions
- [ ] All `{{variables}}` are defined in collection
- [ ] README "Last Updated" date changed
- [ ] Version number bumped appropriately
- [ ] Tried importing in Postman and ran 1-2 requests
- [ ] Descriptions explain each request's purpose
- [ ] No duplicate requests across folders

## 📞 Questions?

Refer to full documentation in `POSTMAN_COLLECTION_README.md` section "For Agents & Copilot: Collection Maintenance Guide"

---

**Remember:** The collection represents the API's public contract. Keep it complete, accurate, and up-to-date.
