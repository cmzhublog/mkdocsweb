package main

import "encoding/json"

// Validate structural relationships before replacing a user's last good workspace.
// Rendering and Markdown interpretation remain in the frontend.
func validWorkspace(raw json.RawMessage) bool {
	var v struct {
		ActiveID string `json:"activeId"`
		Notes    []struct {
			ID        string   `json:"id"`
			Title     *string  `json:"title"`
			Content   *string  `json:"content"`
			UpdatedAt *float64 `json:"updatedAt"`
			FolderID  *string  `json:"folderId"`
			Remote    *struct {
				RepositoryID string `json:"repositoryId"`
				Path         string `json:"path"`
				SHA          string `json:"sha"`
			} `json:"remote"`
		} `json:"notes"`
		Folders []struct {
			ID        string  `json:"id"`
			Name      *string `json:"name"`
			ParentID  *string `json:"parentId"`
			Collapsed *bool   `json:"collapsed"`
		} `json:"folders"`
		Repositories []struct {
			ID           string `json:"id"`
			RootFolderID string `json:"rootFolderId"`
		} `json:"repositories"`
	}
	if json.Unmarshal(raw, &v) != nil || len(v.Notes) == 0 || v.Folders == nil {
		return false
	}
	folders := map[string]*string{}
	for _, f := range v.Folders {
		if f.ID == "" || f.Name == nil || f.Collapsed == nil {
			return false
		}
		if _, ok := folders[f.ID]; ok {
			return false
		}
		folders[f.ID] = f.ParentID
	}
	for id, parent := range folders {
		seen := map[string]bool{id: true}
		for parent != nil {
			if seen[*parent] {
				return false
			}
			seen[*parent] = true
			var ok bool
			parent, ok = folders[*parent]
			if !ok {
				return false
			}
		}
	}
	repos := map[string]bool{}
	roots := map[string]bool{}
	for _, r := range v.Repositories {
		if r.ID == "" || repos[r.ID] || roots[r.RootFolderID] {
			return false
		}
		if _, ok := folders[r.RootFolderID]; !ok {
			return false
		}
		repos[r.ID] = true
		roots[r.RootFolderID] = true
	}
	notes := map[string]bool{}
	for _, n := range v.Notes {
		if n.ID == "" || notes[n.ID] || n.Title == nil || n.Content == nil || n.UpdatedAt == nil {
			return false
		}
		notes[n.ID] = true
		if n.FolderID != nil {
			if _, ok := folders[*n.FolderID]; !ok {
				return false
			}
		}
		if n.Remote != nil && (!repos[n.Remote.RepositoryID] || n.Remote.Path == "" || !shaPattern.MatchString(n.Remote.SHA) || *n.Content != "") {
			return false
		}
	}
	return notes[v.ActiveID] && validImageAssets(raw)
}
