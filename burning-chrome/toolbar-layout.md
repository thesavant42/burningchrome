```mermaid
flowchart LR
    subgraph Row1
        A["Input: bucketUrlInput"]
        B["Button: fetchBucket"]
        subgraph Reports
            C["Select: savedReportsSelect"]
            D["Button: deleteSavedReport"]
            E["Button: exportAllReports"]
            F["Button: importXmlBtn"]
            G["Input: importXmlFile"]
        end
        H["Select: themeSelect"]
    end

    subgraph Row2
        I["Input: searchInput"]
        subgraph Tabs
            J["Button: viewTableBtn"]
            K["Button: viewTreeBtn"]
            L["Button: viewStatsBtn"]
        end
        subgraph Export
            M["Select: exportFormatSelect"]
        end
    end
    ```