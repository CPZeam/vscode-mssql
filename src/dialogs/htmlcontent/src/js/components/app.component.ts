/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import { Component, OnInit, Inject, forwardRef, ViewChild, ViewChildren, QueryList, ElementRef,
    EventEmitter, ChangeDetectorRef, AfterViewChecked } from '@angular/core';
import { IObservableCollection, SlickGrid, VirtualizedCollection } from 'angular2-slickgrid';
import { ISlickRange, FieldType, IColumnDefinition, IGridDataRow,
    IGridIcon, IMessage, IRange, ISelectionData, DbCellValue } from '../../../../../models/interfaces';
import { DataService } from './../services/data.service';
import { ShortcutService } from './../services/shortcuts.service';
import { ContextMenu } from './contextmenu.component';
import { MessagesContextMenu } from './messagescontextmenu.component';

import * as Constants from './../constants';
import * as Utils from './../utils';

/** enableProdMode */
import {enableProdMode} from '@angular/core';
enableProdMode();

// text selection helper library
declare let rangy;

export interface IGridDataSet {
    dataRows: IObservableCollection<IGridDataRow>;
    columnDefinitions: IColumnDefinition[];
    resized: EventEmitter<any>;
    totalRows: number;
    batchId: number;
    resultId: number;
    maxHeight: number | string;
    minHeight: number | string;
}

// tslint:disable:max-line-length
const template = `
Hello world from my-app 2
`;
// tslint:enable:max-line-length

/**
 * Top level app component which runs and controls the SlickGrid implementation
 */
@Component({
    selector: 'my-app',
    host: { '(window:keydown)': 'keyEvent($event)',
        '(window:gridnav)': 'keyEvent($event)',
        '(window:resize)' : 'resizeResults()'
     },
    template: template,
    providers: [DataService, ShortcutService],
    styles: [`
    .errorMessage {
        color: var(--color-error);
    }
    .batchMessage {
        padding-left: 20px;
    }
    `]
})

export class AppComponent implements OnInit, AfterViewChecked {
    // CONSTANTS
    private scrollTimeOutTime = 200;
    private windowSize = 50;
    private maxScrollGrids = 8;
    private selectionModel = 'DragRowSelectionModel';
    private slickgridPlugins = ['AutoColumnSize'];
    private _rowHeight = 29;
    private _resultsPaneBoundary = 22;
    private _defaultNumShowingRows = 8;
    private Constants = Constants;
    private Utils = Utils;
    private _messagesPaneHeight: number;

    // the function implementations of keyboard available events
    private shortcutfunc = {
        'event.focusResultsGrid': () => {
            this.slickgrids.toArray()[this.activeGrid]._grid.setActiveCell(0, 1);
        },
        'event.toggleResultPane': () => {
            this.resultActive = !this.resultActive;
        },
        'event.toggleMessagePane': () => {
            this.toggleMessagesPane();
        },
        'event.nextGrid': () => {
            this.navigateToGrid(this.activeGrid + 1);
        },
        'event.prevGrid': () => {
            this.navigateToGrid(this.activeGrid - 1);
        },
        'event.copySelection': () => {
            let range: IRange = this.getSelectedRangeUnderMessages();
            let messageText = range ? range.text() : '';
            if (messageText.length > 0) {
                this.executeCopy(messageText);
            } else {
                let activeGrid = this.activeGrid;
                let selection = this.slickgrids.toArray()[activeGrid].getSelectedRanges();
                selection = this.tryCombineSelections(selection);
                this.dataService.copyResults(selection, this.renderedDataSets[activeGrid].batchId, this.renderedDataSets[activeGrid].resultId);
            }
        },
        'event.copyWithHeaders': () => {
            let activeGrid = this.activeGrid;
            let selection = this.slickgrids.toArray()[activeGrid].getSelectedRanges();
            selection = this.tryCombineSelections(selection);
            this.dataService.copyResults(selection, this.renderedDataSets[activeGrid].batchId,
                this.renderedDataSets[activeGrid].resultId, true);
        },
        'event.maximizeGrid': () => {
            this.magnify(this.activeGrid);
        },
        'event.selectAll': () => {
            this.slickgrids.toArray()[this.activeGrid].selection = true;
        },
        'event.saveAsCSV': () => {
            this.sendSaveRequest('csv');
        },
        'event.saveAsJSON': () => {
            this.sendSaveRequest('json');
        },
        'event.saveAsExcel': () => {
            this.sendSaveRequest('excel');
        }
    };

    private dataIcons: IGridIcon[] = [
        {
            showCondition: () => { return this.dataSets.length > 1; },
            icon: () => {
                return this.renderedDataSets.length === 1
                    ? 'exitFullScreen'
                    : 'extendFullScreen';
            },
            hoverText: () => {
                return this.renderedDataSets.length === 1
                    ? Constants.restoreLabel
                    : Constants.maximizeLabel;
            },
            functionality: (batchId, resultId, index) => {
                this.magnify(index);
            }
        },
        {
            showCondition: () => { return true; },
            icon: () => { return 'saveCsv'; },
            hoverText: () => { return Constants.saveCSVLabel; },
            functionality: (batchId, resultId, index) => {
                let selection = this.slickgrids.toArray()[index].getSelectedRanges();
                selection = this.tryCombineSelections(selection);
                if (selection.length <= 1) {
                    this.handleContextClick({type: 'savecsv', batchId: batchId, resultId: resultId, index: index, selection: selection});
                } else {
                    this.dataService.showWarning(Constants.msgCannotSaveMultipleSelections);
                }
            }
        },
        {
            showCondition: () => { return true; },
            icon: () => { return 'saveJson'; },
            hoverText: () => { return Constants.saveJSONLabel; },
            functionality: (batchId, resultId, index) => {
                let selection = this.slickgrids.toArray()[index].getSelectedRanges();
                selection = this.tryCombineSelections(selection);
                if (selection.length <= 1) {
                    this.handleContextClick({type: 'savejson', batchId: batchId, resultId: resultId, index: index, selection: selection});
                } else {
                    this.dataService.showWarning(Constants.msgCannotSaveMultipleSelections);
                }
            }
        },
        {
            showCondition: () => { return true; },
            icon: () => { return 'saveExcel'; },
            hoverText: () => { return Constants.saveExcelLabel; },
            functionality: (batchId, resultId, index) => {
                let selection = this.slickgrids.toArray()[index].getSelectedRanges();
                selection = this.tryCombineSelections(selection);
                if (selection.length <= 1) {
                    this.handleContextClick({type: 'saveexcel', batchId: batchId, resultId: resultId, index: index, selection: selection});
                } else {
                    this.dataService.showWarning(Constants.msgCannotSaveMultipleSelections);
                }
            }
        }
    ];

    private startString = new Date().toLocaleTimeString();
    private config;

    // FIELDS
    // All datasets
    private dataSets: IGridDataSet[] = [];
    // Place holder data sets to buffer between data sets and rendered data sets
    private placeHolderDataSets: IGridDataSet[] = [];
    // Datasets currently being rendered on the DOM
    private renderedDataSets: IGridDataSet[] = this.placeHolderDataSets;
    private messages: IMessage[] = [];
    private scrollTimeOut: NodeJS.Timeout;
    private messagesAdded = false;
    private resizing = false;
    private resizeHandleTop = 0;
    private scrollEnabled = true;
    private resultActive = true;
    private _messageActive = true;
    private firstRender = true;
    private resultsScrollTop = 0;
    private activeGrid = 0;
    private messageShortcut;
    private resultShortcut;
    private totalElapsedTimeSpan: number;
    private complete = false;
    private uri: string;
    private hasRunQuery: boolean = false;
    private resultsFontSize;
    @ViewChild('contextmenu') contextMenu: ContextMenu;
    @ViewChild('messagescontextmenu') messagesContextMenu: MessagesContextMenu;
    @ViewChildren('slickgrid') slickgrids: QueryList<SlickGrid>;

    set messageActive(input: boolean) {
        this._messageActive = input;
        if (this.resultActive) {
            this.resizeGrids();
        }
    }

    get messageActive(): boolean {
        return this._messageActive;
    }

    constructor(@Inject(forwardRef(() => DataService)) public dataService: DataService,
                @Inject(forwardRef(() => ShortcutService)) private shortcuts: ShortcutService,
                @Inject(forwardRef(() => ElementRef)) private _el: ElementRef,
                @Inject(forwardRef(() => ChangeDetectorRef)) private cd: ChangeDetectorRef) {}

    /**
     * Called by Angular when the component is initialized
     */
    ngOnInit(): void {
        const self = this;
        this.setupResizeBind();
        this.dataService.config.then((config) => {
            this.config = config;
            self._messageActive = self.config.messagesDefaultOpen;
            self.resultsFontSize = self.config.resultsFontSize;
            this.shortcuts.stringCodeFor('event.toggleMessagePane').then((result) => {
                self.messageShortcut = result;
            });
            this.shortcuts.stringCodeFor('event.toggleResultPane').then((result) => {
                self.resultShortcut = result;
            });
        });
        this.dataService.dataEventObs.subscribe(event => {
            switch (event.type) {
                case 'start':
                    self.uri = event.data;
                    // Empty the data set if the query is run
                    // again on the same panel
                    if (self.hasRunQuery) {
                        self.dataSets = [];
                        self.placeHolderDataSets = [];
                        self.renderedDataSets = self.placeHolderDataSets;
                        self.messages = [];
                        self.complete = false;
                        self.messagesAdded = false;
                        self.hasRunQuery = false;
                    }
                    break;
                case 'complete':
                    self.totalElapsedTimeSpan = event.data;
                    self.complete = true;
                    self.messagesAdded = true;
                    self.hasRunQuery = true;
                    // reset results and messages expansion state
                    // for new queries
                    self.resultActive = true;
                    self.messageActive = true;
                    break;
                case 'message':
                    self.messages.push(event.data);
                    break;
                case 'resultSet':
                    let resultSet = event.data;

                    // Setup a function for generating a promise to lookup result subsets
                    let loadDataFunction = (offset: number, count: number): Promise<IGridDataRow[]> => {
                        return self.dataService.getRows(offset, count, resultSet.batchId, resultSet.id).then(rows => {
                            let gridData: IGridDataRow[] = [];
                            for (let row = 0; row < rows.rows.length; row++) {
                                // Push row values onto end of gridData for slickgrid
                                gridData.push({
                                    values: rows.rows[row]
                                });
                            }
                            return gridData;
                        });
                    };

                    // Precalculate the max height and min height
                    let maxHeight = resultSet.rowCount < self._defaultNumShowingRows
                        ? Math.max((resultSet.rowCount + 1) * self._rowHeight, self.dataIcons.length * 30) + 10
                        : 'inherit';
                    let minHeight = resultSet.rowCount >= self._defaultNumShowingRows
                        ? (self._defaultNumShowingRows + 1) * self._rowHeight + 10
                        : maxHeight;

                    // Store the result set from the event)
                    let dataSet: IGridDataSet = {
                        resized: undefined,
                        batchId: resultSet.batchId,
                        resultId: resultSet.id,
                        totalRows: resultSet.rowCount,
                        maxHeight: maxHeight,
                        minHeight: minHeight,
                        dataRows: new VirtualizedCollection(
                            self.windowSize,
                            resultSet.rowCount,
                            loadDataFunction,
                            index => { return { values: [] }; }
                        ),
                        columnDefinitions: resultSet.columnInfo.map((c, i) => {
                            let isLinked = c.isXml || c.isJson;
                            let linkType = c.isXml ? 'xml' : 'json';
                            return {
                                id: i.toString(),
                                name: c.columnName === 'Microsoft SQL Server 2005 XML Showplan'
                                    ? 'XML Showplan'
                                    : Utils.htmlEntities(c.columnName),
                                type: self.stringToFieldType('string'),
                                formatter: isLinked ? self.hyperLinkFormatter : AppComponent.textFormatter,
                                asyncPostRender: isLinked ? self.linkHandler(linkType) : undefined
                            };
                        })
                    };
                    self.dataSets.push(dataSet);

                    // Create a dataSet to render without rows to reduce DOM size
                    let undefinedDataSet = JSON.parse(JSON.stringify(dataSet));
                    undefinedDataSet.columnDefinitions = dataSet.columnDefinitions;
                    undefinedDataSet.dataRows = undefined;
                    undefinedDataSet.resized = new EventEmitter();
                    self.placeHolderDataSets.push(undefinedDataSet);
                    self.messagesAdded = true;
                    self.onScroll(0);
                    break;
                default:
                    console.error('Unexpected proxy event type "' + event.type + '" sent');
                    break;
            }
        });
        this.dataService.sendReadyEvent(this.uri);
    }

    ngAfterViewChecked(): void {
        if (this.messagesAdded) {
            this.messagesAdded = false;
            this.scrollMessages();
        }
    }

    /**
     * Used to convert the string to a enum compatible with SlickGrid
     */
    private stringToFieldType(input: string): FieldType {
        let fieldtype: FieldType;
        switch (input) {
            case 'string':
                fieldtype = FieldType.String;
                break;
            default:
                fieldtype = FieldType.String;
                break;
        }
        return fieldtype;
    }

    /**
     * Toggle the messages pane
     */
    private toggleMessagesPane(): void {
        this.messageActive = !this.messageActive
        if (this.messageActive) {
            this.resizeResults();
        }
    }

    /**
     * Toggle the results pane
     */
    private toggleResultsPane(): void {
        this.resultActive = !this.resultActive;
        this.resizeResults();
    }

    /**
     * Returns true if keydown was an Enter os Space
     */
    private handleKeydown(event: KeyboardEvent): boolean {
        // Enter
        if ((event.keyCode === 13 || event.code === 'Enter') ||
            // Space bar
            (event.keyCode === 32 || event.code === 'Space')) {
                event.stopPropagation();
                event.preventDefault();
                return true;
        }
        return false;
    }

    /**
     * Handles toggling messages via key event
     */
    private handleMessagesKeydown(event: KeyboardEvent): void {
        if (this.handleKeydown(event)) {
            this.toggleMessagesPane();
        }
    }

    /**
     * Handles toggling messages via key event
     */
    private handleResultsKeydown(event: KeyboardEvent): void {
        if (this.handleKeydown(event)) {
            this.toggleResultsPane();
        }
    }


    /**
     * Send save result set request to service
     */
    handleContextClick(event: {type: string, batchId: number, resultId: number, index: number, selection: ISlickRange[]}): void {
        switch (event.type) {
            case 'savecsv':
                this.dataService.sendSaveRequest(event.batchId, event.resultId, 'csv', event.selection);
                break;
            case 'savejson':
                this.dataService.sendSaveRequest(event.batchId, event.resultId, 'json', event.selection);
                break;
            case 'saveexcel':
                this.dataService.sendSaveRequest(event.batchId, event.resultId, 'excel', event.selection);
                break;
            case 'selectall':
                this.activeGrid = event.index;
                this.shortcutfunc['event.selectAll']();
                break;
            case 'copySelection':
                this.dataService.copyResults(event.selection, event.batchId, event.resultId);
                break;
            case 'copyWithHeaders':
                this.dataService.copyResults(event.selection, event.batchId, event.resultId, true);
                break;
            case 'copyAllHeaders':
                this.dataService.copyResults(undefined, event.batchId, event.resultId, true);
                break;
            default:
                break;
        }
    }

    openContextMenu(event: {x: number, y: number}, batchId, resultId, index): void {
        let selection = this.slickgrids.toArray()[index].getSelectedRanges();
        selection = this.tryCombineSelections(selection);
        this.contextMenu.show(event.x, event.y, batchId, resultId, index, selection);
    }

    private tryCombineSelections(selections: ISlickRange[]): ISlickRange[] {
        if (!selections || selections.length === 0 || selections.length === 1) {
            return selections;
        }

        // If the selections combine into a single continuous selection, this will be the selection
        let unifiedSelection: ISlickRange = {
            fromCell: selections.map(range => range.fromCell).reduce((min, next) => next < min ? next : min),
            fromRow: selections.map(range => range.fromRow).reduce((min, next) => next < min ? next : min),
            toCell: selections.map(range => range.toCell).reduce((max, next) => next > max ? next : max),
            toRow: selections.map(range => range.toRow).reduce((max, next) => next > max ? next : max)
        };

        // Verify whether all cells in the combined selection have actually been selected
        let verifiers: ((cell: [number, number]) => boolean)[] = [];
        selections.forEach(range => {
            verifiers.push((cell: [number, number]) => {
                return cell[0] >= range.fromRow && cell[0] <= range.toRow && cell[1] >= range.fromCell && cell[1] <= range.toCell;
            });
        });
        for (let row = unifiedSelection.fromRow; row <= unifiedSelection.toRow; row++) {
            for (let column = unifiedSelection.fromCell; column <= unifiedSelection.toCell; column++) {
                // If some cell in the combined selection isn't actually selected, return the original selections
                if (!verifiers.some(verifier => verifier([row, column]))) {
                    return selections;
                }
            }
        }
        return [unifiedSelection];
    }

    private sendSaveRequest(format: string): void {
        let activeGrid = this.activeGrid;
        let batchId = this.renderedDataSets[activeGrid].batchId;
        let resultId = this.renderedDataSets[activeGrid].resultId;
        let selection = this.slickgrids.toArray()[activeGrid].getSelectedRanges();
        selection = this.tryCombineSelections(selection);
        this.dataService.sendSaveRequest(batchId, resultId, format, selection);
    }

    /**
     * Perform copy and do other actions for context menu on the messages component
     */
    handleMessagesContextClick(event: {type: string, selectedRange: IRange}): void {
        switch (event.type) {
            case 'copySelection':
                let selectedText = event.selectedRange.text();
                this.executeCopy(selectedText);
                break;
            default:
                break;
        }
    }

    openMessagesContextMenu(event: any): void {
        event.preventDefault();
        let selectedRange: IRange = this.getSelectedRangeUnderMessages();
        this.messagesContextMenu.show(event.clientX, event.clientY, selectedRange);
    }


    getSelectedRangeUnderMessages(): IRange {
        let selectedRange: IRange = undefined;
        let msgEl = this._el.nativeElement.querySelector('#messages');
        if (msgEl) {
            selectedRange = this.getSelectedRangeWithin(msgEl);
        }
        return selectedRange;
    }

    getSelectedRangeWithin(el): IRange {
        let selectedRange = undefined;
        let sel = rangy.getSelection();
        let elRange = <IRange> rangy.createRange();
        elRange.selectNodeContents(el);
        if (sel.rangeCount) {
            selectedRange = sel.getRangeAt(0).intersection(elRange);
        }
        elRange.detach();
        return selectedRange;
    }

    // Copy text as text
    executeCopy(text: string): void {
        let input = document.createElement('textarea');
        document.body.appendChild(input);
        input.value = text;
        input.style.position = 'absolute';
        input.style.bottom = '100%';
        input.focus();
        input.select();
        document.execCommand('copy');
        input.remove();
    }

    /**
     * Add handler for clicking on xml link
     */
    xmlLinkHandler = (cellRef: string, row: number, dataContext: JSON, colDef: any) => {
        this.handleLink(cellRef, row, dataContext, colDef, 'xml');
    }

    /**
     * Add handler for clicking on json link
     */
    jsonLinkHandler = (cellRef: string, row: number, dataContext: JSON, colDef: any) => {
        this.handleLink(cellRef, row, dataContext, colDef, 'json');
    }

    private handleLink(cellRef: string, row: number, dataContext: JSON, colDef: any, linkType: string): void {
        const self = this;
        let value = self.getCellValueString(dataContext, colDef);
        $(cellRef).children('.xmlLink').click(function(): void {
            self.dataService.openLink(value, colDef.name, linkType);
        });
    }

    private getCellValueString(dataContext: JSON, colDef: any): string {
        let returnVal = '';
        if (!dataContext) {
            return returnVal;
        }

        let value = dataContext[colDef.field];
        if (Utils.isDbCellValue(value)) {
            returnVal = value.displayValue;
        } else if (typeof value === 'string') {
            returnVal = value;
        }
        return returnVal;
    }

    /**
     * Return asyncPostRender handler based on type
     */
    public linkHandler(type: string): Function {
        if (type === 'xml') {
            return this.xmlLinkHandler;
        } else if (type === 'json') {
            return this.jsonLinkHandler;
        }
    }

    /**
     * Format xml field into a hyperlink and performs HTML entity encoding
     */
    public hyperLinkFormatter(row: number, cell: any, value: DbCellValue, columnDef: any, dataContext: any): string {
        let cellClasses = 'grid-cell-value-container';
        let valueToDisplay: string;
        if (Utils.isDbCellValue(value)) {
            // Show NULL values as text
            if (Utils.isNullValueCell(value)) {
                return AppComponent.textFormatter(row, cell, value, columnDef, dataContext);
            }
            cellClasses += ' xmlLink';
            valueToDisplay = Utils.htmlEntities(value.displayValue);
            return `<a class="${cellClasses}" href="#" >${valueToDisplay}</a>`;
        }

        // If we make it to here, we don't have a DbCellValue
        cellClasses += ' missing-value';
        return `<span class="${cellClasses}"></span>`;
    }

    /**
     * Format all text to replace all new lines with spaces and performs HTML entity encoding
     */
    static textFormatter(row: number, cell: any, value: DbCellValue, columnDef: any, dataContext: any): string {
        let cellClasses = 'grid-cell-value-container';
        let valueToDisplay: string;
        if (Utils.isDbCellValue(value)) {
            valueToDisplay = Utils.htmlEntities(value.displayValue.replace(/(\r\n|\n|\r)/g, ' '));
            if (value.isNull) {
                cellClasses += ' missing-value';
            }
        } else {
            valueToDisplay = '';
        }

        return `<span title="${valueToDisplay}" class="${cellClasses}">${valueToDisplay}</span>`;
    }

    /**
     * Handles rendering the results to the DOM that are currently being shown
     * and destroying any results that have moved out of view
     * @param scrollTop The scrolltop value, if not called by the scroll event should be 0
     */
    onScroll(scrollTop): void {
        const self = this;
        clearTimeout(self.scrollTimeOut);
        this.scrollTimeOut = setTimeout(() => {
            if (self.dataSets.length < self.maxScrollGrids) {
                self.scrollEnabled = false;
                for (let i = 0; i < self.placeHolderDataSets.length; i++) {
                    self.placeHolderDataSets[i].dataRows = self.dataSets[i].dataRows;
                    self.placeHolderDataSets[i].resized.emit();
                }
            } else {
                self.scrollEnabled = true;
                let gridHeight = self._el.nativeElement.getElementsByTagName('slick-grid')[0].offsetHeight;
                let tabHeight = self._el.nativeElement.querySelector('#results').offsetHeight;
                let numOfVisibleGrids = Math.ceil((tabHeight / gridHeight)
                    + ((scrollTop % gridHeight) / gridHeight));
                let min = Math.floor(scrollTop / gridHeight);
                let max = min + numOfVisibleGrids;
                for (let i = 0; i < self.placeHolderDataSets.length; i++) {
                    if (i >= min && i < max) {
                        if (self.placeHolderDataSets[i].dataRows === undefined) {
                            self.placeHolderDataSets[i].dataRows = self.dataSets[i].dataRows;
                            self.placeHolderDataSets[i].resized.emit();
                        }
                    } else if (self.placeHolderDataSets[i].dataRows !== undefined) {
                        self.placeHolderDataSets[i].dataRows = undefined;
                    }
                }
            }

            if (self.firstRender) {
                self.firstRender = false;
                setTimeout(() => {
                    self.slickgrids.toArray()[0].setActive();
                });
            }
        }, self.scrollTimeOutTime);
    }

    /**
     * Sends a get request to the provided uri without changing the active page
     * @param uri The URI to send a get request to
     */
    sendGetRequest(selectionData: ISelectionData): void {
        this.dataService.setEditorSelection(selectionData);
    }

    /**
     * Sets up the resize for the messages/results panes bar
     */
    setupResizeBind(): void {
        const self = this;
        let $resizeHandle = $(self._el.nativeElement.querySelector('#messageResizeHandle'));
        let $messagePane = $(self._el.nativeElement.querySelector('#messages'));
        $resizeHandle.bind('dragstart', (e) => {
            self.resizing = true;
            self.resizeHandleTop = e.pageY;
            this._messagesPaneHeight = $('#messages').get(0).clientHeight;
            return true;
        });

        $resizeHandle.bind('drag', (e) => {
            self.resizeHandleTop = e.pageY;
        });

        $resizeHandle.bind('dragend', (e) => {
            self.resizing = false;
            // redefine the min size for the messages based on the final position
            $messagePane.css('min-height', $(window).height() - (e.pageY + 22));
            this.resizeResults();
        });
    }

    /**
     * Ensures the messages tab is scrolled to the bottom
     */
    scrollMessages(): void {
        let messagesDiv = this._el.nativeElement.querySelector('#messages');
        messagesDiv.scrollTop = messagesDiv.scrollHeight;
    }

    /**
     * Makes a resultset take up the full result height if this is not already true
     * Otherwise rerenders the result sets from default
     */
    magnify(index: number): void {
        const self = this;
        if (this.renderedDataSets.length > 1) {
            this.renderedDataSets = [this.placeHolderDataSets[index]];
        } else {
            this.renderedDataSets = this.placeHolderDataSets;
            this.onScroll(0);
        }
        setTimeout(() => {
            for (let grid of self.renderedDataSets) {
                grid.resized.emit();
            }
            self.slickgrids.toArray()[0].setActive();
        });
    }

    /**
     *
     */
    async keyEvent(e: any): Promise<void> {
        // set selection to none for messages so that ctrl + A
        // only selects the results grid
        const isGridSelection: boolean = e.target.classList.contains('slick-cell');
        if (isGridSelection) {
            $('#messages').css('user-select', 'none');
        } else {
            // otherwise make the messages selectable
            $('#messages').css('user-select', 'text');
        }
        let eString = this.shortcuts.buildEventString(e);
        let result = await this.shortcuts.getEvent(eString);
        if (result) {
            let eventName = <string> result;
            // Don't select all the grid if it's not grid selection
            // otherwise run every shortcut function
            if (!(eventName === 'event.selectAll' && !isGridSelection)) {
                this.shortcutfunc[eventName]();
            }
            if (eventName === 'event.selectAll') {
                window.getSelection().empty();
                rangy.getSelection().removeAllRanges();
            }
            e.stopImmediatePropagation();
        }
    }

    /**
     *
     */
    onMouseDown(event: MouseEvent): void {
        this.slickgrids.toArray()[this.activeGrid].selection = false;
        window.getSelection().empty();
        rangy.getSelection().removeAllRanges();
        $('#messages').css('user-select', 'text').focus();
    }

    /**
     * Resizes the results pane
     */
    resizeResults(): void {
        let scrollableHeight = $('.results.vertBox.scrollable').get(0).clientHeight;
        $('.horzBox').get(0).style.height = `${scrollableHeight - this._resultsPaneBoundary}px`;
        this.resizeGrids();
    }

    /**
     * Handles rendering and unrendering necessary resources in order to properly
     * navigate from one grid another. Should be called any time grid navigation is performed
     * @param targetIndex The index in the renderedDataSets to navigate to
     * @returns A boolean representing if the navigation was successful
     */
    navigateToGrid(targetIndex: number): boolean {
        // check if the target index is valid
        if (targetIndex >= this.renderedDataSets.length || targetIndex < 0) {
            return false;
        }

        // Deselect any text since we are navigating to a new grid
        // Do this even if not switching grids, since this covers clicking on the grid after message selection
        rangy.getSelection().removeAllRanges();

        // check if you are actually trying to change navigation
        if (this.activeGrid === targetIndex) {
            return false;
        }

        this.slickgrids.toArray()[this.activeGrid].selection = false;
        this.slickgrids.toArray()[targetIndex].setActive();
        this.activeGrid = targetIndex;

        // scrolling logic
        let resultsWindow = $('#results');
        let scrollTop = resultsWindow.scrollTop();
        let scrollBottom = scrollTop + resultsWindow.height();
        let gridHeight = $(this._el.nativeElement).find('slick-grid').height();
        if (scrollBottom < gridHeight * (targetIndex + 1)) {
            scrollTop += (gridHeight * (targetIndex + 1)) - scrollBottom;
            resultsWindow.scrollTop(scrollTop);
        }
        if (scrollTop > gridHeight * targetIndex) {
            scrollTop = (gridHeight * targetIndex);
            resultsWindow.scrollTop(scrollTop);
        }

        return true;
    }

    resizeGrids(): void {
        const self = this;
        setTimeout(() => {
            for (let grid of self.renderedDataSets) {
                    grid.resized.emit();
                }
        });
    }
}