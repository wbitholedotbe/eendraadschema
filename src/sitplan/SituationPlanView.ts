/**
 * Deze class behandelt het tekenen van het situatieplan.
 * 
 * Er wordt regelmatig de terminologie Box gebruikt in de code. Een box is een sleepbaar element en kan zowel
 * een eendraadschema symbool zijn als een ingelezen extern bestand.
 */

class SituationPlanView {
    private zoomfactor:number = 1;

    /** Referentie naar meerdere DIV's waar het stuatieplan wordt weergegeven 
     *   - paper: hieronder hangen de reële elementen en dit stelt het printable gedeelte van het schema voor
     *   - outerdiv: deze bevat paper en ook het niet printable gedeelte
    */
    private outerdiv: HTMLElement = null;
    private paper: HTMLElement = null;
    
    private draggedBox:HTMLElement = null; /** Box die op dit moment versleept wordt of null */
    private selectedBox:HTMLElement = null; /** Geselelecteerde box of null */

    private mousedrag: MouseDrag; /** behandelt het verslepen van een box */

    private sitplan;

    private event_manager;

    constructor(outerdiv: HTMLElement, paper: HTMLElement, sitplan: SituationPlan) {
        this.outerdiv = outerdiv;
        this.paper = paper;
        this.sitplan = sitplan;
        this.paper.style.transformOrigin = 'top left'; // Keep the origin point consistent when scaling

        this.mousedrag = new MouseDrag();
        this.event_manager = new EventManager();
        
        // Verwijder alle selecties wanneer we ergens anders klikken dan op een box
        this.event_manager.addEventListener(outerdiv, 'mousedown', () => { this.clearSelection(); } );
        this.event_manager.addEventListener(outerdiv, 'touchstart', () => { this.clearSelection(); } );
    }

    /**
     * Maakt deze instance ongedaan en verwijderd alle door deze instance aangemaakte elementen uit de DOM.
     * 
     * Verwijderd eerst de eventmanager en daarna alle elementen in het situatieplan. 
     * Als een element een referentie naar een box heeft, wordt deze verwijderd uit de DOM.
     * Als een element een referentie naar een label heeft, wordt deze verwijderd uit de DOM.
     */
    dispose() {
        //Verwijder de event manager
        this.event_manager.dispose();
        //Ga over all situationplanelements and verwijder de bijhorende boxes uit the DOM
        for (let element of this.sitplan.elements) {
            if (element.boxref != null) element.boxref.remove();
            if (element.boxlabelref != null) element.boxlabelref.remove();
        }
    }

    /**
     * Zorgt ervoor dat alle elementen in het situatieplan een link hebben naar
     * het eendraadschema.
     * 
     * Als een element in het situatieplan verwijst naar een symbool dat niet langer in 
     * het eendraadschema zit, wordt het element verwijderd uit het situatieplan.
     * 
     * Deze functie zorgt er niet voor dat ook elk element effectief een box heeft in de DOM.
     * Dit gebeurt pas in de redraw functie.
     */
    syncToSitPlan() { 
        this.sitplan.syncToEendraadSchema();
    }

    /**
     * Stel de zoomfactor in zodat het paper-element volledig in het browser window wordt weergegeven
     * 
     * @param paperPadding - De padding rond het papier in pixels. Dit wordt gebruikt
     *   om te berekenen hoeveel ruimte beschikbaar is voor het papier. De standaard
     *   is de CSS-waarde van --paperPadding.
     */
    zoomToFit(paperPadding: number = parseFloat(getComputedStyle(this.paper).getPropertyValue('--paperPadding'))) {

        const scale = Math.min(
            (this.outerdiv.offsetWidth - paperPadding * 2) / this.paper.offsetWidth,
            (this.outerdiv.offsetHeight - paperPadding * 2) / this.paper.offsetHeight,
        );

        this.setzoom(scale);
    }

    /**
     * Stel de zoomfactor in.
     * @param factor - De zoomfactor, standaard 1.
     */
    setzoom(factor: number = 1) {
        this.zoomfactor = factor;
        this.paper.style.transform = `scale(${factor})`;
    }

    /**
     * Verhoogt of verlaagt de zoomfactor met een bepaalde waarde.
     * 
     * @param increment - De waarde waarmee de zoomfactor moet worden aangepast.
     *   Een positieve waarde vergroot de zoom, terwijl een negatieve waarde de zoom verkleint.
     *   Standaard is deze waarde 0, wat betekent dat er geen aanpassing is.
     */
    zoomIncrement(increment: number = 0) { //increment is a value indicating how much we can zoom
        this.setzoom(
            Math.min(SITPLANVIEW_ZOOMINTERVAL.MAX,
                Math.max(SITPLANVIEW_ZOOMINTERVAL.MIN, this.zoomfactor + increment)
            )
        );
    }

    /**
     * Maakt een box en een label op de DOM of in een document-fragmentaan voor een element in het situatieplan.
     * 
     * Een box is een sleepbaar element en kan zowel een symbool van het eendraadschema
     * zijn als een in te laden extern bestand.
     *  
     * Event handlers voor het bewegen met muis of touch worden toegevoegd.
     * 
     * Deze functie checkt om efficientie-redenen niet dat het situatieplanelement geldig is
     * en verwijst naar een bestaand element in het eendraadschema. Deze check dient op
     * voorhand te gebeuren, bijvoorbeeld door gebruik te maken van de functie syncToSitPlan.
     * 
     * @param element - Het element in het situatieplan dat een box op de DOM nodig heeft.
     */
    private makeBox(element: SituationPlanElement, fragment: DocumentFragment = null) {
        // Box aanmaken op de DOM voor het symbool of in te laden externe figuur
        // extra property sitPlanElementRef toegevoegd aan DOM zodat we later ons situatieplan element kunnen terugvinden
        let box = document.createElement('div'); 
        Object.assign(box, {id: element.id, className: "box", sitPlanElementRef: element}); 
        element.boxref = box;

        // Boxlabel aanmaken op de DOM voor de tekst bij het symbool
        let boxlabel = document.createElement('div');
        boxlabel.className = "boxlabel";
        boxlabel.innerHTML = element.getAdres(); // is deze nodig? Wellicht reeds onderdeel van updateContent
        element.boxlabelref = boxlabel;

        // Content updaten en toevoegen aan de DOM
        this.updateBoxContent(element); //content moet eerst updated worden om te weten hoe groot de box is
        if (fragment) fragment.append(box, boxlabel); else this.paper.append(box, boxlabel);       
        //this.updateSymbolAndLabelPosition(element); //pas als alles op de DOM zit kunnen we berekenen waar het label hoort

        // Event handlers voor het bewegen met muis of touch
        box.addEventListener('mousedown', this.startDrag);
        box.addEventListener('touchstart', this.startDrag);
        box.addEventListener('touchend', this.stopDrag);
    }

    /**
     * Werk de content van het box-element en label-element van een situatieplanelement bij in de DOM.
     * 
     * Deze functie controleert eerst of het box-element bestaat, zo-niet doet deze functie niets.
     * Daarna wordt de SVG van het symbool van het element gegenereerd.  Indien dit verschilt van wat reeds op de DOM zit wordt de innerHTML van het het box-element gewijzigd.
     * Daarnaast wordt de tekst van het label-element bijgewerkt en de fontsize ingesteld.
     * 
     * TODO: de functie getScaledSVG wordt altijd uitgevoerd en is nodig om te weten of de DOM moet aangepast worden maar dit is minder efficient.
     *       er zijn mogelijk betere manieren om de parameter sitPlanElement.needsViewUpdate te bepalen dan de SVG effectief genereren en te vergelijken met de bestaande SVG op de DOM, 
     *       bijvoorbeeld door een trigger op manipulatie in het ééndraadschema zelf.
     * 
     * @param sitPlanElement - Het situatieplanelement dat aangepast moet worden.
     */
    private updateBoxContent(sitPlanElement: SituationPlanElement | null) {
        if (!sitPlanElement) return;

        const box = sitPlanElement.boxref;
        const boxlabel = sitPlanElement.boxlabelref;
        
        if (box == null) return;

        let svg = sitPlanElement.getScaledSVG(); // Deze call past ook viewUpdateNeeded aan en moet dus eerst gebeuren

        if (sitPlanElement.needsViewUpdate) {
            sitPlanElement.needsViewUpdate = false;

            if (svg != null) box.innerHTML = svg; else box.innerHTML = '';

            if (boxlabel != null) {
                let adres = sitPlanElement.getAdres();
                if (sitPlanElement.labelfontsize != null) boxlabel.style.fontSize = String(sitPlanElement.labelfontsize) + 'px';
                if (adres != null) boxlabel.innerHTML = adres; else boxlabel.innerHTML = '';
            }
        };
    }

    /**
     * Berekent de positie van het label van een situationplanelement in functie vna de grootte van het situationplanelement.
     * het situationplanelement moet daarvoor reeds een box hebben die aan de DOM werd toegevoegd om de grootte van deze box te kunnen bepalen.
     * 
     * Wijzigt eveneens de grootte, en positie van het DIV-element dat het label van een situationplanelement bevat in de DOM.
     * Controleert ook of het label op een zichtbare pagina staat en maakt het onzichtbaar indien nodig.
     * 
     * @param sitPlanElement - Het situatieplanelement waarvoor de positie van het label moet worden berekend.
     */

    private updateLabelPosition(sitPlanElement: SituationPlanElement | null) {
        if (!sitPlanElement) return;
    
        const boxlabel = sitPlanElement.boxlabelref as HTMLElement | null;
        if (!boxlabel) return;

        const scale = sitPlanElement.getscale();
        const forbiddenLabelZone = getXYRectangleSize(
            sitPlanElement.sizex * scale + SITPLANVIEW_SELECT_PADDING, 
            sitPlanElement.sizey * scale + SITPLANVIEW_SELECT_PADDING, 
            sitPlanElement.rotate
        );

        // Berekken de x/left positie van het label
        const adreslocation = sitPlanElement.getAdresLocation();
        switch (adreslocation) {
            case 'links': sitPlanElement.labelposx = sitPlanElement.posx - forbiddenLabelZone.width / 2 - boxlabel.offsetWidth / 2; break;
            case 'rechts': sitPlanElement.labelposx = sitPlanElement.posx + forbiddenLabelZone.width / 2 + boxlabel.offsetWidth / 2; break;
            default: sitPlanElement.labelposx = sitPlanElement.posx;
        }
        const left = `${sitPlanElement.labelposx - boxlabel.offsetWidth / 2}px`;
        if (boxlabel.style.left != left) boxlabel.style.left = left; // Vermijd aanpassingen DOM indien niet nodig

        // Bereken de y/top positie van het label
        // Deze bevat wat meer complexe trickery om alles min of meer overeen te doen komen tussen print en scherm
        let top: string;
        switch (adreslocation) {
            case 'boven': {
                top = `${sitPlanElement.posy - forbiddenLabelZone.height / 2 - boxlabel.offsetHeight * 0.8}px`;
                sitPlanElement.labelposy = sitPlanElement.posy - forbiddenLabelZone.height / 2 - boxlabel.offsetHeight * 0.5 / 2;
                break;
            }
            case 'onder': {
                top = `${sitPlanElement.posy + forbiddenLabelZone.height / 2 - boxlabel.offsetHeight * 0.2}px`;
                sitPlanElement.labelposy = sitPlanElement.posy + forbiddenLabelZone.height / 2 + boxlabel.offsetHeight * 0.7 / 2;
                break;
            }
            default:
                top = `${sitPlanElement.posy - boxlabel.offsetHeight / 2}px`;
                sitPlanElement.labelposy = sitPlanElement.posy + 1;
        }
        if (boxlabel.style.top != top) boxlabel.style.top = top; // Vermijd aanpassingen DOM indien niet nodig

        if (this.sitplan.activePage == sitPlanElement.page) {
            if (boxlabel.classList.contains('hidden')) boxlabel.classList.remove('hidden'); // Vermijd aanpassingen DOM indien niet nodig
        } else  {
            if (!boxlabel.classList.contains('hidden')) boxlabel.classList.add('hidden'); // Vermijd aanpassingen DOM indien niet nodig
        }
    }
    
    /**
     * Wijzigt de grootte, positie en rotatietransformatie van het DIV-element dat een situationplanelement bevat in de DOM.
     * Controleert ook of het symbool op een zichtbare pagina staat en maakt het onzichtbaar indien nodig.
     * 
     * @param sitPlanElement Het situationplanelement dat aangepast moet worden.
     */
    
    private updateSymbolPosition(sitPlanElement: SituationPlanElement | null) {

        function getRotationTransform(sitPlanElement: SituationPlanElement | null): string {
            if (!sitPlanElement) return '';

            let rotation: number = sitPlanElement.rotate % 360;
            let spiegel: boolean = false;

            if ((rotation >= 90) && (rotation < 270)) {
                if (sitPlanElement.rotates360degrees()) spiegel = true;
                if (sitPlanElement.isEendraadschemaSymbool()) rotation -= 180;
            }

            return `rotate(${rotation}deg)` + (spiegel ? ' scaleX(-1)' : '');    
        }

        if (!sitPlanElement) return;

        const div = sitPlanElement.boxref as HTMLElement | null;
        if (!div) return;

        const scale = sitPlanElement.getscale();
        const contentwidth = sitPlanElement.sizex*scale;
        const contentheight = sitPlanElement.sizey*scale;
    
        const left = ((sitPlanElement.posx-contentwidth/2-SITPLANVIEW_SELECT_PADDING)).toString() + "px";
        if (div.style.left != left) div.style.left = left; // Vermijd aanpassingen DOM indien niet nodig

        const top = ((sitPlanElement.posy-contentheight/2-SITPLANVIEW_SELECT_PADDING)).toString() + "px";
        if (div.style.top != top) div.style.top = top; // Vermijd aanpassingen DOM indien niet nodig

        const width = ((contentwidth + SITPLANVIEW_SELECT_PADDING*2)).toString() + "px";
        if (div.style.width != width) div.style.width = width; // Vermijd aanpassingen DOM indien niet nodig

        const height = ((contentheight + SITPLANVIEW_SELECT_PADDING*2)).toString() + "px";
        if (div.style.height != height) div.style.height = height; // Vermijd aanpassingen DOM indien niet nodig
        
        const transform = getRotationTransform(sitPlanElement);
        if (div.style.transform != transform) div.style.transform = transform; // Vermijd aanpassingen DOM indien niet nodig

        if (this.sitplan.activePage == sitPlanElement.page) {
            if (div.classList.contains('hidden')) div.classList.remove('hidden'); // Vermijd aanpassingen DOM indien niet nodig
        } else  {
            if (!div.classList.contains('hidden')) div.classList.add('hidden'); // Vermijd aanpassingen DOM indien niet nodig
        }
    }
    
    /**
     * Werkt de positie van het symbool bij op de DOM indien nodig.
     * Berekent de positie van het label en werkt deze bij op de DOM indien nodig
     *     * 
     * @param sitPlanElement - Het situationplanelement
     */

    private updateSymbolAndLabelPosition(sitPlanElement: SituationPlanElement | null) {
        if (!sitPlanElement) return;
        this.updateSymbolPosition(sitPlanElement); // Eerst content aanpassen anders kennen we de grootte van het symbool niet
        this.updateLabelPosition(sitPlanElement);
    }
    
    /**
     * Werkt de situatieplanweergave bij door elementen te synchroniseren met de onderliggende datastructuur.
     *
     * Deze functie zorgt er eerst voor dat alle elementen in het situatieplan een overeenkomstige box in de DOM hebben.
     * Het creëert ontbrekende boxes en voegt deze toe aan het document. Vervolgens werkt het de positie en 
     * het label van elk symbool bij volgens de huidige staat. Daarna past het de weergave aan om de actieve pagina 
     * weer te geven en werkt het de UI-ribbon bij.
     *
     * Deze methode meet en logt de tijd die nodig is om de redraw-operatie te voltooien.
     * Het gebruik van document fragments maakt de redraw aanzienlijk sneller in google chrome.
     * In Firefox is deze ook snel zonder document fragments.
     */

    redraw() {
        const start = performance.now();
        this.syncToSitPlan();
        
        const fragment: DocumentFragment = document.createDocumentFragment();

        let appendNeeded = false;
        for (let element of this.sitplan.elements) {
            if (!element.boxref) { this.makeBox(element, fragment); appendNeeded = true; }
        }
        if (appendNeeded) this.paper.append(fragment); // We moeten de boxes toevoegen aan de DOM alvorens de label positie te berekenen aangezien we de size van de labels moeten kennen

        this.showPage(this.sitplan.activePage);
        for (let element of this.sitplan.elements) {
            if (element.page == this.sitplan.activePage) {
                this.updateBoxContent(element);
                this.updateSymbolAndLabelPosition(element);
            }
        }

        this.updateRibbon();
        const end = performance.now();
        console.log(`Redraw took ${end - start}ms`);
    }

    /**
     * Maakt de gegeven box de geselecteerde box.
     * 
     * @param box - Het element dat geselecteerd moet worden.
     */
    private selectBox(box: HTMLElement | null) {
        if (!box) return;
        box.classList.add('selected');
        this.selectedBox = box;
    }

    /**
     * Verwijdert de selectie van alle boxes.
     */
    clearSelection() {
        let boxes = document.querySelectorAll('.box');
        boxes.forEach(b => b.classList.remove('selected'));
        this.selectedBox = null;
    }

    /**
     * Verwijdert de geselecteerde box en verwijdert deze ook uit het situatieplan.
     * Verwijdert ook het bijhorende label.
     */
    deleteSelectedBox() {
        if (this.selectedBox == null) return;
        let id = this.selectedBox.id;
        let sitPlanElement = (this.selectedBox as any).sitPlanElementRef;

        if (sitPlanElement == null) return;

        this.selectedBox.remove();
        if (sitPlanElement.boxlabelref != null) sitPlanElement.boxlabelref.remove();

        this.sitplan.removeElement(sitPlanElement);

        this.selectedBox = null;
    }

    /**
     * Send the selected box to the back of the z-index stack and reorder the elements of the situation plan accordingly
     * so that after saving or during printing the elements are drawn in the same order.
     * 
     * @returns void
     */
    sendToBack() {
        if (this.selectedBox == null) return;

        for (let element of this.sitplan.elements) {
            if (element.boxref != null) {
                let newzindex;

                if (element.boxref != this.selectedBox) {
                    newzindex = (parseInt(element.boxref.style.zIndex) || 0)+1;
                } else { 
                    newzindex = 0; }

                element.boxref.style.zIndex = newzindex.toString();
                if (element.boxlabelref != null) { 
                    element.boxlabelref.style.zIndex = newzindex.toString(); }
                
            }
        }            
        
        this.sitplan.orderByZIndex();
        undostruct.store();
    }

    /**
     * Send the selected box to the front of the z-index stack and reorder the elements of the situation plan accordingly
     * so that after saving or during printing the elements are drawn in the same order.
     * 
     * @returns void
     */
    bringToFront() {
        if (this.selectedBox == null) return;

        let newzindex = 0;
        for (let element of this.sitplan.elements) {
            if ( (element.boxref != null) && (element.boxref != this.selectedBox) ) {
                newzindex = Math.max(newzindex, parseInt(element.boxref.style.zIndex) || 0);
            } 
        }
        newzindex += 1;            
        
        let element = (this.selectedBox as any).sitPlanElementRef;
        if (element == null) { this.sitplan.syncToSitPlan(); return; } 

        this.selectedBox.style.zIndex = newzindex.toString();
        if (element.boxlabelref != null) element.boxlabelref.style.zIndex = newzindex.toString();

        this.sitplan.orderByZIndex();
        undostruct.store();
    }

    /**
     * Start een sleepactie voor een box in het situatieplan.
     * 
     * @param event - De gebeurtenis die de sleepactie activeert (muisklik of touchstart).
     */
    private startDrag = (event) => {
        event.stopPropagation();   // Voorkomt body klikgebeurtenis
        this.clearSelection();     // Wist bestaande selectie
        this.selectBox(event.target); // Selecteert de box die we willen slepen
        this.draggedBox = event.target; // Houdt de box die we aan het slepen zijn

        switch (event.type) {
            case 'mousedown':
                this.mousedrag.startDrag(event.clientX, event.clientY, this.draggedBox.offsetLeft, this.draggedBox.offsetTop, this.zoomfactor);
                document.addEventListener('mousemove', this.processDrag);
                document.addEventListener('mouseup', this.stopDrag);
                break;
            case 'touchstart':
                const touch = event.touches[0];
                this.mousedrag.startDrag(touch.clientX, touch.clientY, this.draggedBox.offsetLeft, this.draggedBox.offsetTop, this.zoomfactor);
                document.addEventListener('touchmove', this.processDrag, { passive: false });
                document.addEventListener('touchend', this.stopDrag);
                break;
            default:
                console.error('Ongeldige event voor startDrag functie');
        }        
    }

    /**
     * Stopt de sleepactie van een box in het situatieplan en stopt de eventlisteners.
     * 
     * @param event - De gebeurtenis die de sleepactie stopt (muisklik release of touchend).
     */
    private stopDrag = (event) => {
        event.stopPropagation();

        switch (event.type) {
            case 'mouseup':
                document.removeEventListener('mousemove', this.processDrag);
                document.removeEventListener('mouseup', this.stopDrag);
                break;
            case 'touchend':
                document.removeEventListener('touchmove', this.processDrag);
                document.removeEventListener('touchend', this.stopDrag);
                break;
            default:
                console.error('Ongeldige event voor stopDrag functie');
        }

        this.draggedBox = null;
        undostruct.store();
    }

    /**
     * Verwerkt een muisklik of touch event tijdens het slepen van een box in het situatieplan.
     * 
     * @param event - De gebeurtenis die verwerkt wordt (muisklik of touchmove).
     */
    private processDrag = (event) => {
        if (this.draggedBox) {
            event.preventDefault();

            let newLeftTop: {left: number,top: number};
            if (event.type === 'mousemove') {
                newLeftTop = this.mousedrag.returnNewLeftTop(event.clientX,event.clientY);
            } else if (event.type === 'touchmove') {
                const touch = event.touches[0];
                newLeftTop = this.mousedrag.returnNewLeftTop(touch.clientX,touch.clientY);
            }
    
            // Zorg ervoor dat de box niet buiten redelijke grenzen van het canvas valt links-boven
            // We doen deze controle niet rechts onder omdat het canvas daar gewoon kan groeien
            newLeftTop.left = Math.max(- this.draggedBox.offsetWidth/2, newLeftTop.left);
            newLeftTop.top = Math.max(- this.draggedBox.offsetHeight/2, newLeftTop.top);

            const sitPlanElement = (this.draggedBox as any).sitPlanElementRef;
            sitPlanElement.posx = newLeftTop.left + (this.draggedBox.offsetWidth/2);
            sitPlanElement.posy = newLeftTop.top + (this.draggedBox.offsetHeight/2);

            this.updateSymbolAndLabelPosition(sitPlanElement);
        }
    } 

    /**
     * Selecteer een pagina.
     * 
     * @param page - Het nummer van de pagina die getoond moet worden.
     */
    selectPage(page: number) {
        this.sitplan.activePage = page;
        this.redraw();
    }

    /**
     * Toont enkel de elementen die op de pagina staan die als parameter wordt meegegeven.
     * 
     * @param page - Het nummer van de pagina die getoond moet worden.
     */
    showPage(page: number) {
        for (let element of this.sitplan.elements) {
            if (element.page != page) {
                element.boxref.classList.add('hidden');
                element.boxlabelref.classList.add('hidden');
            } else {
                element.boxref.classList.remove('hidden');
                element.boxlabelref.classList.remove('hidden');
            }
        }
        this.updateRibbon();
    }

    /**
     * Hangt een klik event listener aan het gegeven element met als doel de huidig geselecteerde box te verwijderen.
     * 
     * @param elem - Het html element waar de listener wordt aan gehangen.
     */
    attachDeleteButton(elem: HTMLElement) { 
        this.event_manager.addEventListener(elem, 'click', () => { this.deleteSelectedBox(); undostruct.store(); } );      
    };

    /**
     * Hangt een klik event listener aan het gegeven element met als doel de huidig geselecteerde box naar de achtergrond te sturen.
     * 
     * @param elem - Het html element waar de listener wordt aan gehangen.
     */
    attachSendToBackButton(elem: HTMLElement) { 
        this.event_manager.addEventListener(elem, 'click', () => { this.sendToBack(); } ); 
    };

    /**
     * Hangt een klik event listener aan het gegeven element met als doel de huidig geselecteerde box naar de voorgrond te brengen.
     * 
     * @param elem - Het html element waar de listener wordt aan gehangen.
     */
    attachBringToFrontButton(elem: HTMLElement) { 
        this.event_manager.addEventListener(elem, 'click', () => { this.bringToFront(); } ); 
    };

    /**
     * Hangt een klik event listener aan het gegeven element met als doel de zoomfactor aan te passen.
     * 
     * @param elem - Het html element waar de listener wordt aan gehangen.
     * @param increment - De waarde waarmee de zoomfactor wordt aangepast. Een positieve waarde vergroot de zoom,
     *                    terwijl een negatieve waarde de zoom verkleint.
     */
    attachZoomButton(elem: HTMLElement, increment: number) { 
        this.event_manager.addEventListener(elem, 'click', () => { this.zoomIncrement(increment); } ); 
    };

    /**
     * Hangt een klik event listener aan het gegeven element met als doel het situatieplan
     * aan te passen aan de beschikbare ruimte in het browservenster.
     * 
     * @param elem - Het html element waar de listener wordt aan gehangen.
     */
    attachZoomToFitButton(elem: HTMLElement) { 
        this.event_manager.addEventListener(elem, 'click', () => { this.zoomToFit(); } ); 
    };

    /**
     * Hangt een klik event listener aan het gegeven element om een bestand te kiezen en een verandering event listener aan het invoerelement
     * om een nieuw element vanuit een bestand aan het situatieplan toe te voegen.
     * 
     * @param elem - Het HTML-element dat bij een klik een bestand moet openen.
     * @param fileinput - Het invoerelement voor bestanden dat het bestand uploadt wanneer het verandert.
     */
    attachAddElementFromFileButton(elem: HTMLElement, fileinput: HTMLElement) {
        this.event_manager.addEventListener(elem, 'click', () => { fileinput.click(); } );
        this.event_manager.addEventListener(fileinput, 'change', (event) => { 
            let element = this.sitplan.addElementFromFile(event, this.sitplan.activePage, 550, 300, 
                (() => {
                    this.syncToSitPlan();
                    this.clearSelection();
                    element.needsViewUpdate = true; // for an external SVG this is needed, for an electroItem it is automatically set (see next function)
                    this.redraw();
                    this.selectBox(element.boxref); // We moeten dit na redraw doen anders bestaat de box mogelijk nog niet
                    this.bringToFront();
                    undostruct.store();
                    (fileinput as HTMLInputElement).value = ''; // Zorgt ervoor dat hetzelfde bestand twee keer kan worden gekozen en dit nog steeds een change triggert
                }).bind(this)
            );
        });
    }

    /**
     * Hangt een klik event listener aan het gegeven element om een nieuw Electro_Item aan het situatieplan toe te voegen.
     * 
     * @param elem - Het HTML-element dat bij een klik een nieuw element toevoegt.
     */
    attachAddElectroItemButton(elem: HTMLElement) {
        this.event_manager.addEventListener(elem, 'click', () => {
            SituationPlanView_ElementPropertiesPopup(null,
                (id, adrestype, adres, adreslocation, labelfontsize, scale, rotate) => {
                    if (id != null) {
                        let element = this.sitplan.addElementFromElectroItem(id, this.sitplan.activePage, 550, 300, 
                                                                  adrestype, adres, adreslocation, labelfontsize,
                                                                  scale, rotate);
                        if (element != null) {
                            this.syncToSitPlan();
                            this.clearSelection();
                            this.redraw();
                            this.selectBox(element.boxref); // We moeten dit na redraw doen anders bestaat de box mogelijk nog niet
                            this.bringToFront();
                            undostruct.store();
                        }
                    } else {
                        alert('Geen geldig ID ingegeven!');
                    }
                }
            ); 
        });
    }

    /**
     * Hangt een klik event listener aan het gegeven element om een bestaand element in het situatieplan te bewerken.
     * 
     * @param elem - Het HTML-element dat bij een klik een bestaand element in het situatieplan bewerkt.
     */
    attachEditButton(elem: HTMLElement) {
        this.event_manager.addEventListener(elem, 'click', () => {
            if (this.selectedBox) {
                const sitPlanElement = (this.selectedBox as any).sitPlanElementRef;
                if (!sitPlanElement) return;

                SituationPlanView_ElementPropertiesPopup(sitPlanElement,
                    (electroid, adrestype, adres, adreslocation, labelfontsize, scale, rotate) => {
                        if (electroid != null) {
                            sitPlanElement.setElectroItemId(electroid);
                            sitPlanElement.setAdres(adrestype,adres,adreslocation);
                        }
                        sitPlanElement.labelfontsize = labelfontsize;
                        sitPlanElement.setscale(scale);
                        sitPlanElement.rotate = rotate;
                        
                        this.updateBoxContent(sitPlanElement); //content needs to be updated first to know the size of the box
                        this.updateSymbolAndLabelPosition(sitPlanElement);
                        undostruct.store();
                    }
                );
            }
        } );
    }

    /**
     * Maakt de knoppen in de ribbon aan om onder andere pagina's te selecteren, elementen te laden of verwijderen en pagina's te zoomen.
     * Deze functie wordt aangeroepen telkens er iets in de toestand verandert die mogelijk kan leiden tot aanpassingen in de ribbon.
     * 
     * Deze functie hangt ook onclick events aan interne functies in deze class.
     * 
     * TODO: Er zijn efficientiewinsten mogelijk door niet telkens de hele ribbon te hertekenen.
     */
    updateRibbon() {
        let outputleft: string = "";
        let outputright: string = "";

        // -- Undo/redo buttons --

        outputleft += `
            <div class="icon" ${(undostruct.undoStackSize() > 0 ? 'onclick="undoClicked()"' : 'style="filter: opacity(45%)"')}>
                <img src="gif/undo.png" alt="Ongedaan maken" class="icon-image">
                <span class="icon-text">Ongedaan maken</span>
            </div>
            <div class="icon"  ${(undostruct.redoStackSize() > 0 ? 'onclick="redoClicked()"' : 'style=\"filter: opacity(45%)\"')}>
                <img src="gif/redo.png" alt="Opnieuw" class="icon-image">
                <span class="icon-text">Opnieuw</span>
            </div>`

        // -- Visuals om items te laden of verwijderen --

        outputleft += `
            <span style="display: inline-block; width: 30px;"></span>
            <div class="icon" id="button_Add">
                <span class="icon-image" style="font-size:24px">➕</span>
                <span class="icon-text">Uit bestand</span>
            </div>
            <div class="icon" id="button_Add_electroItem">
                <span class="icon-image" style="font-size:24px">➕</span>
                <span class="icon-text">Uit schema</span>
            </div>
            <div class="icon" id="button_Delete">
                <span class="icon-image" style="font-size:24px">🗑</span>
                <span class="icon-text">Verwijder</span>
            </div>`;

        // -- Visuals om items te bewerken --

        outputleft += `
            <span style="display: inline-block; width: 10px;"></span>
            <div class="icon" id="button_edit">
                <span class="icon-image" style="font-size:24px">📝</span>
                <span class="icon-text">Bewerk</span>
            </div>`;

        // -- Visuals om naar achteren of voren te sturen --

        outputleft += `
            <span style="display: inline-block; width: 10px;"></span>
            <div class="icon" id="sendBack">
                <span class="icon-image" style="font-size:24px">⬇⬇</span>
                <span class="icon-text">Naar achter</span>
            </div>
            <div class="icon" id="bringFront">
                <span class="icon-image" style="font-size:24px">⬆⬆</span>
                <span class="icon-text">Naar voor</span>
            </div>`

        // -- Visuals om pagina te selecteren --

        outputleft  += `
            <span style="display: inline-block; width: 50px;"></span>
            <div>
                <center>
                    <span style="display: inline-block; white-space: nowrap;">Pagina
                        <select id="id_sitplanpage">`;
                            for (let i=1; i<= this.sitplan.numPages; i++) {
                                outputleft += '<option value="' + i + '"' + (i == this.sitplan.activePage ? ' selected' : '') + '>' + i + '</option>';
                            }

        outputleft +=  `
                        </select>
                    </span><br><span style="display: inline-block; white-space: nowrap;">
                        <button id="btn_sitplan_addpage" ${(this.sitplan.activePage != this.sitplan.numPages ? ' disabled' : '')}>Nieuw</button>
                        <button id="btn_sitplan_delpage" style="background-color:red;" ${(this.sitplan.numPages <= 1 ? ' disabled' : '')}>&#9851;</button>
                    </span>
                </center>
            </div>`;
 
        // -- Visuals om pagina te zoomen --

        outputright += `
            <span style="display: inline-block; width: 10px;"></span>
            <div class="icon" id="button_zoomin">
                <span class="icon-image" style="font-size: 24px;">🔍</span>
                <span class="icon-text">In</span>
            </div>
            <div class="icon" id="button_zoomout">
                <span class="icon-image" style="font-size: 24px;">🌍</span>
                <span class="icon-text">Uit</span>
            </div>
            <div class="icon" id="button_zoomToFit">
                <span class="icon-image" style="font-size: 24px;">🖥️</span>
                <!--<img src="gif/scaleup.png" alt="Schermvullend" class="icon-image">-->
                <span class="icon-text">Schermvullend</span>
            </div>
            <span style="display: inline-block; width: 10px;"></span>`;
        
        // -- Put everything in the ribbon --

        document.getElementById("ribbon").innerHTML = `<div id="left-icons">${outputleft}</div><div id="right-icons">${outputright}</div>`;

        // -- Actions om pagina te selecteren --

        document.getElementById('id_sitplanpage')!.onchange = (event: Event) => {
            const target = event.target as HTMLSelectElement;
            this.selectPage(Number(target.value));
            undostruct.store();
        };
        
        document.getElementById('btn_sitplan_addpage')!.onclick = () => {
            this.sitplan.numPages++;
            this.selectPage(this.sitplan.numPages);
        };

        document.getElementById('btn_sitplan_delpage')!.onclick = () => {
            const userConfirmation = confirm('Pagina '+this.sitplan.activePage+' volledig verwijderen?'); 
            if (userConfirmation) {
                this.sitplan.numPages--;
                this.selectPage(Math.min(this.sitplan.activePage,this.sitplan.numPages));
            }
        };

        // -- Actions om elementen toe te voegen of verwijderen --

        this.attachAddElementFromFileButton(document.getElementById('button_Add'), document.getElementById('fileInput'));
        this.attachAddElectroItemButton(document.getElementById('button_Add_electroItem'));
        this.attachDeleteButton(document.getElementById('button_Delete'));

        // -- Actions om visuals te bewerken --

        this.attachEditButton(document.getElementById('button_edit'));

        // -- Actions om naar achteren te sturen --

        this.attachSendToBackButton(document.getElementById('sendBack'));
        this.attachBringToFrontButton(document.getElementById('bringFront'));

        // -- Actions om pagina te zoomen --

        this.attachZoomButton(document.getElementById('button_zoomin'), 0.1);
        this.attachZoomButton(document.getElementById('button_zoomout'), -0.1);
        this.attachZoomToFitButton(document.getElementById('button_zoomToFit'));
        
    }

    /*  

    scaleBox(increment: number) {
        if (this.selectedBox) {
            let pic = (this.selectedBox as any).sitPlanElementRef;
            if (pic==null) return;

            pic.setscale(Math.min(Math.max(0.1,pic.getscale()+increment),1000));
            
            this.updateBoxContent(pic); //content needs to be updated first to know the size of the box
            this.updateSymbolAndLabelPosition(pic);
        }
    }

    rotateBox(degrees: number) {
        if (this.selectedBox) {
            let id = this.selectedBox.id;
            let pic = (this.selectedBox as any).sitPlanElementRef;
            pic.rotate = (pic.rotate + degrees) % 360;
            this.selectedBox.style.transform = `rotate(${pic.rotate}deg)`;
        }
    }

    attachScaleButton(elem: HTMLElement, increment: number) { 
        this.event_manager.addEventListener(elem, 'click', () => { this.scaleBox(increment); undostruct.store(); } ); 
    };

    attachRotateButton(elem: HTMLElement, increment: number) { 
        this.event_manager.addEventListener(elem, 'click', () => { this.rotateBox(increment); undostruct.store(); } ); 
    };
    
    */

} // *** END CLASS ***

/**
 * Toon de pagina voor het situatieplan
 */
function showSituationPlanPage() {
    toggleAppView('draw');

    if (!(structure.sitplan)) { structure.sitplan = new SituationPlan() };

    if (!(structure.sitplanview)) {
        //Verwijder eerst alle elementen op de DOM met id beginnend met "SP_" om eventuele wezen
        //uit eerdere oefeningen te voorkomen
        let elements = document.querySelectorAll('[id^="SP_"]');
        elements.forEach(e => e.remove());
        //Maak dan de SituationPlanView
        structure.sitplanview = new SituationPlanView(
            document.getElementById('outerdiv'), 
            document.getElementById('paper'), 
            structure.sitplan);

        structure.sitplanview.zoomToFit();
    };
    
    structure.sitplanview.redraw();      

    // Initialize the HelperTip with the storage
    const helperTip = new HelperTip(appDocStorage);
    helperTip.show('sitplan.introductie',
    `<h3>Situatieschema</h3>
    <p>Op deze pagina kan u een situatieschema tekenen</p>
    <p>Laad een plattegrond met de knop "Uit bestand" en voeg symbolen toe met de knop "Uit schema".</p>
    <p>Klik <a href="Documentation/sitplandoc.pdf" target="_blank" rel="noopener noreferrer">hier</a> om in een nieuw venster de documentatie te bekijken.</p>
    <p>Het situatieschema werd recent toegevoegd aan het programma en zal nog verder ontwikkeld worden over de komende weken. Opmerkingen zijn welkom in het "contact"-formulier.</p>`);
}
